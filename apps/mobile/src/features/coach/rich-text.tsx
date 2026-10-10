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

export function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);

  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <Text key={index} variant="subheading">
              {block.spans.map((span) => span.text).join('')}
            </Text>
          );
        }

        if (block.kind === 'bullet') {
          return (
            <View key={index} style={styles.bullet}>
              <Text variant="body" color="textSecondary" style={styles.marker}>
                {block.marker}
              </Text>
              <Text variant="body" style={styles.bulletText}>
                <Spans spans={block.spans} />
              </Text>
            </View>
          );
        }

        return (
          <Text key={index} variant="body">
            <Spans spans={block.spans} />
          </Text>
        );
      })}
    </View>
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
