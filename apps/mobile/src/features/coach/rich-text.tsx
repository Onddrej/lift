/**
 * A coach's prose, laid out.
 *
 * The parsing is `parseRichText` in `@lift/shared`, under test; this only
 * chooses a text style per block. Bullets get a hanging indent so a wrapped
 * line starts under the words rather than under the dot, which is the
 * difference between a list and a paragraph with dots in it.
 */

import { parseRichText, type RichSpan } from '@lift/shared';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { spacing } from '@/theme';

export interface RichTextProps {
  text: string;
  /** Ends the last block with a cursor, while the text is still being written. */
  cursor?: boolean;
}

export function RichText({ text, cursor = false }: RichTextProps) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  const last = blocks.length - 1;

  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => {
        const tail = cursor && index === last ? <Cursor /> : null;

        // Selectable so a long press offers Copy, which is how a line of advice
        // leaves the app without a clipboard module.
        if (block.kind === 'heading') {
          return (
            <Text key={index} variant="subheading" selectable>
              {block.spans.map((span) => span.text).join('')}
              {tail}
            </Text>
          );
        }

        if (block.kind === 'bullet') {
          return (
            <View key={index} style={styles.bullet}>
              <Text variant="body" color="textSecondary" style={styles.marker}>
                {block.marker}
              </Text>
              <Text variant="body" style={styles.bulletText} selectable>
                <Spans spans={block.spans} />
                {tail}
              </Text>
            </View>
          );
        }

        return (
          <Text key={index} variant="body" selectable>
            <Spans spans={block.spans} />
            {tail}
          </Text>
        );
      })}
    </View>
  );
}

/** Inline, so it sits after the last word rather than on a line of its own. */
function Cursor() {
  return (
    <Text variant="body" color="accent">
      {'\u2009\u25CF'}
    </Text>
  );
}

function Spans({ spans }: { spans: RichSpan[] }) {
  return spans.map((span, index) =>
    span.bold ? (
      <Text key={index} variant="bodyMedium">
        {span.text}
      </Text>
    ) : (
      span.text
    ),
  );
}

const styles = StyleSheet.create({
  blocks: { gap: spacing.sm },
  bullet: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xs },
  marker: { minWidth: 14 },
  bulletText: { flex: 1 },
});
