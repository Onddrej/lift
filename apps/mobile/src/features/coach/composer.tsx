/**
 * Where a question to the coach is written.
 *
 * One rounded box rather than a field beside a button: the text grows upward
 * inside it, and the row underneath carries what the coach is reading (the
 * window of the log) and the send control. Send is a filled circle that only
 * lights once there is something to send, and becomes stop while an answer is
 * streaming, so the one control in the corner always does the one thing that
 * can be done next.
 */

import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui';
import { font, fontSize, HIT_SLOP, radius, spacing, stroke, useColors } from '@/theme';

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** An answer is streaming: the corner control stops it instead of sending. */
  pending: boolean;
  /** Nothing can be sent at all, such as with no model set up. */
  disabled?: boolean;
  placeholder?: string;
  /** "Last 30 days": what the coach is reading. Tapping it changes that. */
  context?: string;
  onContextPress?: () => void;
}

export const Composer = forwardRef<TextInput, ComposerProps>(function Composer(
  { value, onChangeText, onSend, onStop, pending, disabled = false, placeholder, context, onContextPress },
  ref,
) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const canSend = !pending && !disabled && value.trim().length > 0;

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.borderStrong : colors.border,
        },
      ]}
    >
      <TextInput
        ref={ref}
        multiline
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Ask your coach anything'}
        placeholderTextColor={colors.textTertiary}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { color: colors.text }]}
      />

      <View style={styles.toolbar}>
        {context ? (
          <Pressable
            onPress={onContextPress}
            disabled={!onContextPress}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Coach is reading: ${context}. Change`}
            style={({ pressed }) => [
              styles.context,
              { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
            ]}
          >
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <Text variant="caption" color="textSecondary">
              {context}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}

        <Pressable
          onPress={pending ? onStop : onSend}
          disabled={!pending && !canSend}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={pending ? 'Stop the answer' : 'Send'}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: pending
                ? colors.surfaceMuted
                : canSend
                  ? pressed
                    ? colors.accentPressed
                    : colors.accent
                  : colors.surfaceMuted,
            },
          ]}
        >
          <Ionicons
            name={pending ? 'stop' : 'arrow-up'}
            size={pending ? 14 : 18}
            color={pending ? colors.text : canSend ? colors.textOnAccent : colors.textTertiary}
          />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.xl,
    borderWidth: stroke.outline,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    minHeight: 44,
    maxHeight: 140,
    fontSize: fontSize.md,
    ...font('regular'),
    padding: 0,
    textAlignVertical: 'top',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: stroke.outline,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
