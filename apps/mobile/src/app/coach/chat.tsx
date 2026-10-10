import { Ionicons } from '@expo/vector-icons';
import {
  buildCoachDocument,
  COACH_CHECK_IN_REQUEST,
  COACH_TOOLS,
  coachChatBrief,
  describeToolCall,
  estimateTokens,
  type AiConfig,
  type AiMessage,
  type AiToolResult,
} from '@lift/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Screen, Text, TextField, useScrollEdge } from '@/components/ui';
import { requireAiConfig, streamTurn, type StreamedTurn } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import { appendMessage, createThread, readMessages } from '@/features/ai/threads';
import { CoachReply } from '@/features/coach/coach-reply';
import { buildCoachReport } from '@/features/coach/report';
import { runCoachTool } from '@/features/coach/tools';
import type { StatRange } from '@/features/analytics/windows';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/**
 * Room for a full review with plan cards in it, and for anything after it.
 *
 * Plan cards are JSON, which costs more tokens per word of advice than prose
 * does. Cutting a four-day programme off in the middle of its third card is
 * worse than not asking.
 */
const MAX_OUTPUT_TOKENS = 6144;

/**
 * Lookups allowed before the coach has to answer with what it has.
 *
 * Each round is a request, and a model that keeps asking for one more history
 * is spending the user's money on its own uncertainty. Four covers "compare
 * these three lifts and check my routines"; the last round is sent without
 * tools, so it can only answer.
 */
const MAX_LOOKUP_ROUNDS = 4;

/**
 * The document only travels once.
 *
 * Every turn after the first is a question about an answer the model can still
 * see, so the thread carries the whole exchange and the log is never re-read.
 * Rebuilding it per turn would not merely cost tokens: the log moves, so a
 * follow-up would silently change the evidence underneath an answer that has
 * already been given. What the coach needs beyond it, it looks up.
 */
export default function CoachChatScreen() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();
  const unit = useSettings((state) => state.weightUnit);
  const params = useLocalSearchParams<{
    /** An existing conversation to reopen. When set, nothing is re-read or re-asked. */
    thread?: string;
    range?: string;
    sessions?: string;
    routines?: string;
    note?: string;
  }>();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<AiError | null>(null);
  const [question, setQuestion] = useState('');

  const threadId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /**
   * What has streamed in so far, mirrored out of state.
   *
   * The stop path needs to read the partial answer and write it to the
   * database. Doing that from inside a `setStreaming` updater would work by
   * accident and break on purpose: React may invoke an updater more than once,
   * and an updater with an insert in it would then store the turn twice.
   */
  const partial = useRef('');
  /**
   * Whether this provider takes tools at all.
   *
   * Claude and DeepSeek do. Behind the OpenAI-compatible option there may be a
   * local model that refuses a request with tools in it outright; the first such
   * refusal turns lookups off for the rest of the conversation, and the coach
   * answers from the export alone.
   */
  const toolsAccepted = useRef(true);
  const scroller = useRef<ScrollView | null>(null);
  const started = useRef(false);

  /**
   * Runs one exchange to its answer: stream, look up what was asked for,
   * stream again, until the coach replies without asking for anything.
   *
   * Takes the turns explicitly rather than reading state, because the opening
   * request is issued in the same tick that puts the document into state and
   * would otherwise send an empty list.
   */
  const send = useCallback(
    async (turns: AiMessage[]) => {
      const controller = new AbortController();
      abort.current = controller;

      setPending(true);
      setError(null);
      setStreaming('');
      partial.current = '';

      let conversation = turns;

      /** Puts a turn on screen and in the database, in that order. */
      const commit = async (message: AiMessage) => {
        conversation = [...conversation, message];
        setMessages(conversation);
        if (threadId.current) await appendMessage(threadId.current, message);
      };

      try {
        const config = await requireAiConfig();

        for (let round = 0; ; round++) {
          const offerTools = toolsAccepted.current && round < MAX_LOOKUP_ROUNDS;

          let turn: StreamedTurn;
          try {
            turn = await ask(config, conversation, offerTools, unit, controller.signal, (text) => {
              partial.current += text;
              setStreaming((current) => current + text);
            });
          } catch (cause) {
            // A server that cannot take tools says so with a 400 before a word
            // is written. Ask again without them rather than failing the chat.
            if (
              offerTools &&
              cause instanceof AiError &&
              cause.kind === 'bad-response' &&
              partial.current.length === 0
            ) {
              toolsAccepted.current = false;
              round -= 1;
              continue;
            }
            throw cause;
          }

          if (turn.toolCalls.length === 0) {
            await commit({ role: 'assistant', content: turn.text });
            break;
          }

          // The text that came with the calls is part of the turn that asked
          // for them, and is stored with it.
          partial.current = '';
          setStreaming('');
          await commit({
            role: 'assistant',
            content: turn.text,
            toolCalls: turn.toolCalls,
            ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
          });

          // Answered even when the user has pressed stop in the meantime. The
          // lookups are local and quick, and a stored call with no answer is a
          // conversation both providers refuse to continue.
          const results = await Promise.all(turn.toolCalls.map(runCoachTool));
          await commit({ role: 'user', content: '', toolResults: results });

          if (controller.signal.aborted) throw new AiError('aborted');
        }
      } catch (cause) {
        const failure = cause instanceof AiError ? cause : new AiError('bad-response');

        // A stop is not a failure, and what arrived before it is worth keeping:
        // the user pressed stop because they had read enough, not because the
        // answer was wrong.
        if (failure.kind === 'aborted') {
          const written = partial.current;
          if (written.length > 0) await commit({ role: 'assistant', content: written });
        } else {
          setError(failure);
        }
      } finally {
        setStreaming('');
        partial.current = '';
        setPending(false);
        if (abort.current === controller) abort.current = null;
      }
    },
    [unit],
  );

  // The opening turn. Runs once, guarded by a ref rather than by the dependency
  // array: this spends money, and a re-run caused by a re-render would spend it
  // again without anybody asking.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        // Reopening. The stored turns are the conversation, and re-reading the
        // log to rebuild the document would be both a wasted request and a lie:
        // the training has moved since the answer was written, and an answer
        // must keep the evidence it was actually given.
        if (params.thread) {
          threadId.current = params.thread;
          setMessages(answerDangling(await readMessages(params.thread)));
          setPending(false);
          return;
        }

        const report = await buildCoachReport({
          range: (params.range as StatRange) ?? '30d',
          includeSessions: params.sessions !== '0',
          includeRoutines: params.routines !== '0',
          note: params.note?.trim() || null,
        });

        // The request rides in the document's turn rather than its own: two
        // user turns in a row is a conversation Anthropic refuses.
        const opening: AiMessage[] = [
          { role: 'user', content: `${buildCoachDocument(report)}\n\n${COACH_CHECK_IN_REQUEST}` },
        ];
        setMessages(opening);

        const config = await requireAiConfig();
        threadId.current = await createThread({
          kind: 'review',
          title: report.rangeLabel,
          model: config.model,
        });
        await appendMessage(threadId.current, opening[0]!);

        await send(opening);
      } catch (cause) {
        setError(cause instanceof AiError ? cause : new AiError('bad-response'));
        setPending(false);
      }
    })();

    return () => {
      // Leaving the screen stops the stream rather than paying for an answer
      // into a screen that is gone.
      abort.current?.abort();
    };
  }, [params.thread, params.range, params.sessions, params.routines, params.note, send]);

  const say = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || pending || messages.length === 0) return;

      const turn: AiMessage = { role: 'user', content: text };
      const turns: AiMessage[] = [...messages, turn];
      setQuestion('');
      setMessages(turns);

      if (threadId.current) void appendMessage(threadId.current, turn);
      void send(turns);
    },
    [pending, messages, send],
  );

  // The document is the first turn and is tens of thousands of characters. It is
  // not shown: nobody wants to read their own log back, and the screen it was
  // built on already offers a preview of it.
  const conversation = messages.slice(1);
  const lastReply = lastAnswerIndex(conversation);

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Coach' }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          {...scrollEdge.list}
          ref={scroller}
          contentContainerStyle={styles.content}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {messages.length > 0 && (
            <Text variant="caption" color="textTertiary">
              Your log went out as one message of roughly{' '}
              {estimateTokens(messages[0]!.content).toLocaleString()} tokens. The coach looks
              up anything older or more detailed as it needs it.
            </Text>
          )}

          {conversation.map((message, index) => {
            if (message.role === 'user') {
              // A turn that only carries lookup results is the app talking to
              // the model, not the user, and has nothing to show.
              if (message.content.length === 0) return null;
              return (
                <Card key={index} style={styles.question}>
                  <Text variant="body">{message.content}</Text>
                </Card>
              );
            }

            return (
              <View key={index} collapsable={false} style={styles.answer}>
                {message.content.length > 0 && (
                  <CoachReply
                    text={message.content}
                    interactive={!pending && index === lastReply}
                    onChoose={say}
                  />
                )}
                {message.toolCalls?.map((call) => (
                  <View key={call.id} style={styles.lookup}>
                    <Ionicons name="search-outline" size={14} color={colors.textTertiary} />
                    <Text variant="caption" color="textTertiary">
                      {describeToolCall(call)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}

          {streaming.length > 0 && (
            <CoachReply text={streaming} interactive={false} onChoose={say} />
          )}

          {pending && streaming.length === 0 && (
            <Text variant="body" color="textTertiary">
              {conversation.length === 0 ? 'Reading your training…' : 'Thinking…'}
            </Text>
          )}

          {error && (
            <EmptyState
              icon="cloud-offline-outline"
              title="No answer"
              description={[error.message, error.detail].filter(Boolean).join('\n\n')}
            />
          )}
        </ScrollView>

        <View style={styles.composer}>
          {pending ? (
            <Button
              title="Stop"
              icon="stop-circle-outline"
              variant="secondary"
              fullWidth
              onPress={() => abort.current?.abort()}
            />
          ) : (
            <>
              <TextField
                multiline
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask your coach"
                style={styles.input}
                containerStyle={styles.inputContainer}
              />
              <Button
                title="Send"
                icon="arrow-up"
                disabled={question.trim().length === 0 || messages.length === 0}
                onPress={() => say(question)}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One request, with or without lookups on offer. */
function ask(
  config: AiConfig,
  conversation: AiMessage[],
  offerTools: boolean,
  unit: 'kg' | 'lb',
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<StreamedTurn> {
  return streamTurn(
    config,
    {
      system: coachChatBrief(unit),
      messages: withCurrentReasoning(conversation),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The first user turn is the training document and is re-sent with
      // every follow-up. Anthropic will hold on to it if asked, which is most
      // of what a second question costs.
      cacheFirstMessage: true,
      ...(offerTools ? { tools: COACH_TOOLS } : {}),
    },
    { onDelta, signal },
  );
}

/**
 * DeepSeek's reasoning, kept only for the exchange it belongs to.
 *
 * It must come back with the tool calls it led to while that exchange is still
 * running, and is dead weight once the user has spoken again. Everything up to
 * the last thing the user typed has it stripped.
 */
function withCurrentReasoning(conversation: AiMessage[]): AiMessage[] {
  let lastTyped = -1;
  conversation.forEach((message, index) => {
    if (message.role === 'user' && message.content.length > 0) lastTyped = index;
  });

  return conversation.map((message, index) => {
    if (index > lastTyped || !message.reasoning) return message;
    const { reasoning: _dropped, ...rest } = message;
    return rest;
  });
}

/**
 * Answers a lookup a stored conversation never got the result of.
 *
 * Only reachable when the app was killed between asking and answering, and
 * without it the thread could never be continued: both providers refuse a
 * conversation with an unanswered call in it.
 */
function answerDangling(messages: AiMessage[]): AiMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.toolCalls?.length) return messages;

  const results: AiToolResult[] = last.toolCalls.map((call) => ({
    callId: call.id,
    name: call.name,
    content: 'This lookup was interrupted. Answer without it.',
    isError: true,
  }));
  return [...messages, { role: 'user', content: '', toolResults: results }];
}

/** The latest reply that is an answer rather than a request for a lookup. */
function lastAnswerIndex(conversation: AiMessage[]): number {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const message = conversation[i]!;
    if (message.role === 'user' && message.content.length > 0) return -1;
    if (message.role === 'assistant' && !message.toolCalls?.length) return i;
  }
  return -1;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  question: { gap: spacing.sm },
  // Pinned against Fabric's view flattening: layout-only, and its children
  // change as lookups and the reply arrive.
  answer: { gap: spacing.sm },
  lookup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  inputContainer: { flex: 1 },
  input: { maxHeight: 120, textAlignVertical: 'top' },
});
