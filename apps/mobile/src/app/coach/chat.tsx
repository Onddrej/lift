import { Ionicons } from '@expo/vector-icons';
import {
  buildCoachDocument,
  COACH_STARTERS,
  COACH_TOOLS,
  coachChatBrief,
  describeElapsed,
  describeToolCall,
  type AiConfig,
  type AiMessage,
  type AiToolResult,
} from '@lift/shared';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, EmptyState, HeaderAction, Screen, Text, useScrollEdge } from '@/components/ui';
import { loadAiConfig, requireAiConfig, streamTurn, type StreamedTurn } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import { appendMessage, createThread, listThreads, readMessages, type CoachThread } from '@/features/ai/threads';
import { STAT_RANGES, type StatRange } from '@/features/analytics/windows';
import { CoachReply } from '@/features/coach/coach-reply';
import { Composer } from '@/features/coach/composer';
import { buildCoachReport } from '@/features/coach/report';
import { runCoachTool } from '@/features/coach/tools';
import { useKeyboardInset } from '@/features/coach/use-keyboard-inset';
import { useSession } from '@/features/sync/auth-client';
import { showDialog } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

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

/** Earlier conversations shown on the landing. The rest are on the coach screen. */
const RECENT_THREADS = 6;

/** How long a stored title may run before it is cut. */
const TITLE_LENGTH = 80;

/**
 * The coach.
 *
 * Opens on a landing rather than straight into an answer: a greeting, the
 * composer, a row of starting questions and the conversations already had.
 * Nothing is read or sent until the user asks something, which is also when
 * the log goes out, so an accidental tap costs nothing.
 *
 * The document only travels once. Every turn after the first is a question
 * about an answer the model can still see, so the thread carries the whole
 * exchange and the log is never re-read. Rebuilding it per turn would not
 * merely cost tokens: the log moves, so a follow-up would silently change the
 * evidence underneath an answer that has already been given. What the coach
 * needs beyond it, it looks up.
 */
export default function CoachChatScreen() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const unit = useSettings((state) => state.weightUnit);
  const { data: session } = useSession();
  const params = useLocalSearchParams<{
    /** An existing conversation to reopen. When set, nothing is re-read or re-asked. */
    thread?: string;
    /** A question to send straight away, from a starter outside this screen. */
    ask?: string;
    range?: string;
    sessions?: string;
    routines?: string;
    note?: string;
  }>();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const [question, setQuestion] = useState('');
  const [range, setRange] = useState<StatRange>(isRange(params.range) ? params.range : '30d');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<CoachThread[]>([]);
  /** When the thread list was read, so "3 days ago" is stable across renders. */
  const [listedAt, setListedAt] = useState(0);

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
  const input = useRef<TextInput | null>(null);
  const container = useRef<View | null>(null);
  const opened = useRef(false);

  const keyboard = useKeyboardInset(container);
  // The keyboard covers the home-indicator inset, so the larger of the two is
  // the room to leave, never their sum: summing would float the composer a
  // gesture bar's height above the keys.
  const bottomRoom = useAnimatedStyle(() => ({
    height: Math.max(insets.bottom, keyboard.inset.value),
  }));

  useFocusEffect(
    useCallback(() => {
      void loadAiConfig().then((config) => setConfigured(config !== null));
      void listThreads('review').then((rows) => {
        setThreads(rows);
        setListedAt(Date.now());
      });
    }, []),
  );

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

  /**
   * The first question of a conversation, which is when the log is read.
   *
   * The question rides in the document's turn rather than its own: two user
   * turns in a row is a conversation Anthropic refuses.
   */
  const start = useCallback(
    async (text: string) => {
      setPending(true);
      setError(null);
      setMessages([{ role: 'user', content: text }]);

      try {
        const report = await buildCoachReport({
          range,
          includeSessions: params.sessions !== '0',
          includeRoutines: params.routines !== '0',
          note: params.note?.trim() || null,
        });

        const opening: AiMessage[] = [{ role: 'user', content: `${buildCoachDocument(report)}\n\n${text}` }];
        setMessages(opening);

        const config = await requireAiConfig();
        threadId.current = await createThread({
          kind: 'review',
          // The question, not the window. A list of earlier conversations all
          // titled "Last 30 days" says nothing about which one is which.
          title: text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text,
          model: config.model,
        });
        await appendMessage(threadId.current, opening[0]!);

        await send(opening);
      } catch (cause) {
        // Nothing was asked yet, so nothing is kept: back to the landing with
        // the question still in the box, ready to send again.
        if (!threadId.current) {
          setMessages([]);
          setQuestion(text);
        }
        setError(cause instanceof AiError ? cause : new AiError('bad-response'));
        setPending(false);
      }
    },
    [range, params.sessions, params.routines, params.note, send],
  );

  // Reopening a thread, or a question handed over from another screen. Runs
  // once, guarded by a ref rather than by the dependency array: a question
  // spends money, and a re-run caused by a re-render would spend it again.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    if (params.thread) {
      const id = params.thread;
      threadId.current = id;
      // The stored turns are the conversation. Re-reading the log to rebuild
      // the document would be both a wasted request and a lie: the training has
      // moved since the answer was written, and an answer must keep the
      // evidence it was actually given.
      void readMessages(id).then((stored) => setMessages(answerDangling(stored)));
    } else if (params.ask?.trim()) {
      // A microtask later rather than in the effect's own body, which would set
      // state while the effect is still running.
      const text = params.ask.trim();
      void Promise.resolve().then(() => start(text));
    }
  }, [params.thread, params.ask, start]);

  // Leaving the screen stops the stream rather than paying for an answer into a
  // screen that is gone.
  useEffect(() => () => abort.current?.abort(), []);

  const say = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || pending || configured === false) return;
      setQuestion('');

      if (messages.length === 0) {
        void start(text);
        return;
      }

      const turn: AiMessage = { role: 'user', content: text };
      const turns: AiMessage[] = [...messages, turn];
      setMessages(turns);

      if (threadId.current) void appendMessage(threadId.current, turn);
      void send(turns);
    },
    [pending, configured, messages, start, send],
  );

  const chooseRange = useCallback(async () => {
    const options = STAT_RANGES.filter((option) => option.value !== 'all');
    const index = await showDialog({
      title: 'What should the coach read?',
      message: 'Sessions, sets per muscle, routines and records from this window. Older history it looks up when it needs it.',
      actions: [
        ...options.map((option) => ({ label: option.label, style: 'default' as const })),
        { label: 'Cancel', style: 'cancel' as const },
      ],
    });
    const picked = options[index];
    if (picked) setRange(picked.value);
  }, []);

  const started = messages.length > 0;
  // The document is the first turn and is tens of thousands of characters. It is
  // not shown: nobody wants to read their own log back.
  const conversation = messages.slice(1);
  const lastReply = lastAnswerIndex(conversation);
  const rangeLabel = STAT_RANGES.find((option) => option.value === range)?.label ?? 'Last 30 days';

  const composer = (
    <Composer
      ref={input}
      value={question}
      onChangeText={setQuestion}
      onSend={() => say(question)}
      onStop={() => abort.current?.abort()}
      pending={pending}
      disabled={configured === false}
      placeholder={started ? 'Ask a follow-up' : 'Ask about your training, a lift, or your plan'}
      context={rangeLabel}
      onContextPress={started ? undefined : () => void chooseRange()}
    />
  );

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Coach',
          headerRight: () => (
            <HeaderAction
              label="What the coach reads, and exporting it"
              icon="options-outline"
              onPress={() => router.push('/coach')}
            />
          ),
        }}
      />

      <View ref={container} onLayout={keyboard.remeasure} collapsable={false} style={styles.flex}>
        <ScrollView
          {...scrollEdge.list}
          ref={scroller}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={started ? styles.content : styles.landing}
          onContentSizeChange={() => {
            if (started) scroller.current?.scrollToEnd({ animated: true });
          }}
        >
          {started ? (
            <>
              {conversation.length === 0 && messages[0] && (
                <Card style={styles.question}>
                  <Text variant="body">{firstQuestion(messages[0].content)}</Text>
                </Card>
              )}

              {conversation.map((message, index) => {
                if (message.role === 'user') {
                  // A turn that only carries lookup results is the app talking
                  // to the model, not the user, and has nothing to show.
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

              {streaming.length > 0 && <CoachReply text={streaming} interactive={false} onChoose={say} />}

              {pending && streaming.length === 0 && (
                <Text variant="body" color="textTertiary">
                  {conversation.length === 0 ? 'Reading your training…' : 'Thinking…'}
                </Text>
              )}
            </>
          ) : (
            <>
              <View style={styles.greeting}>
                <Text variant="title" align="center">
                  {greeting(session?.user?.name)}
                </Text>
                <Text variant="body" color="textSecondary" align="center">
                  I read your log before I answer. Where should we start?
                </Text>
              </View>

              {configured === false && (
                <Card style={styles.setup}>
                  <Text variant="bodyMedium">Connect a model to talk to your coach</Text>
                  <Text variant="caption" color="textSecondary">
                    Add a Claude, DeepSeek or OpenAI-compatible key. It stays on this phone. Or
                    export your log and paste it into any AI you already use.
                  </Text>
                  <View style={styles.setupActions}>
                    <Button title="Set up" size="sm" onPress={() => router.push('/settings/ai')} />
                    <Button title="Export instead" size="sm" variant="secondary" onPress={() => router.push('/coach')} />
                  </View>
                </Card>
              )}

              {composer}

              <View style={styles.starters}>
                {COACH_STARTERS.map((starter) => (
                  <Chip
                    key={starter.label}
                    label={starter.label}
                    icon={starter.icon as ComponentProps<typeof Ionicons>['name']}
                    disabled={configured === false || pending}
                    onPress={() => say(starter.question)}
                  />
                ))}
              </View>

              {threads.length > 0 && (
                <View style={styles.previous}>
                  <Text variant="label" color="textSecondary">
                    Previous chats
                  </Text>
                  {threads.slice(0, RECENT_THREADS).map((thread) => (
                    <Pressable
                      key={thread.id}
                      onPress={() => router.push({ pathname: '/coach/chat', params: { thread: thread.id } })}
                      style={({ pressed }) => [
                        styles.thread,
                        {
                          borderColor: colors.border,
                          backgroundColor: pressed ? colors.surfacePressed : colors.surface,
                        },
                      ]}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textTertiary} />
                      <View style={styles.flex}>
                        <Text variant="body" numberOfLines={1}>
                          {thread.title}
                        </Text>
                        <Text variant="caption" color="textTertiary">
                          {describeElapsed(thread.updatedAt, listedAt)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          {error && (
            <EmptyState
              icon="cloud-offline-outline"
              title="No answer"
              description={[error.message, error.detail].filter(Boolean).join('\n\n')}
            />
          )}
        </ScrollView>

        {started && <View style={styles.dock}>{composer}</View>}

        {/* Pinned against Fabric's view flattening: its height animates. */}
        <Animated.View collapsable={false} style={bottomRoom} />
      </View>
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

/**
 * The question the user asked, out of the opening turn it shares with the log.
 *
 * The document ends where the question begins, after the last blank line. A
 * thread from before questions rode along has no question there, and shows the
 * last line of the document's footnotes instead, which is harmless.
 */
function firstQuestion(opening: string): string {
  const cut = opening.lastIndexOf('\n\n');
  return cut === -1 ? opening : opening.slice(cut + 2);
}

function greeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function isRange(value: string | undefined): value is StatRange {
  return STAT_RANGES.some((option) => option.value === value);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  landing: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingVertical: spacing.xxxl,
    gap: spacing.xl,
  },
  greeting: { gap: spacing.sm, alignItems: 'center' },
  setup: { gap: spacing.sm },
  setupActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  previous: { gap: spacing.sm, paddingTop: spacing.lg },
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
  },
  question: { gap: spacing.sm, alignSelf: 'flex-end', maxWidth: '88%' },
  answer: { gap: spacing.sm },
  lookup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dock: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
});
