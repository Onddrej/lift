/**
 * Where a photo of an exercise comes from, or that it should go.
 *
 * Three rows at most, in the order they are reached for: the camera first,
 * because the machine is in front of the person asking; the library second;
 * and removal last and in red, present only when there is something to remove.
 *
 * Rows rather than buttons, on the metrics `OptionList` uses, so this sheet is
 * the same height and rhythm as every other one in the app. It is a list of
 * things to do rather than a list of values, which is why none of them carries
 * a checkmark.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Divider, Sheet, SheetScrollView, Text, useSheetLayout } from '@/components/ui';
import { controlHeight, radius, spacing, useColors } from '@/theme';

import type { PhotoOrigin } from './photo-picker';

export interface ExercisePhotoSheetProps {
  visible: boolean;
  /** Adds the Remove row. */
  hasPhoto: boolean;
  onClose: () => void;
  /** The caller closes the sheet; see `useExercisePhotoPicker`. */
  onPick: (origin: PhotoOrigin) => void;
  onRemove: () => void;
}

export function ExercisePhotoSheet({
  visible,
  hasPhoto,
  onClose,
  onPick,
  onRemove,
}: ExercisePhotoSheetProps) {
  const { bottomInset } = useSheetLayout();

  return (
    <Sheet visible={visible} label="Photo" closeLabel="Close photo options" onClose={onClose}>
      <SheetScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: spacing.sm + bottomInset }}
      >
        <Row icon="camera-outline" label="Take photo" onPress={() => onPick('camera')} />
        <Divider />
        <Row icon="images-outline" label="Choose from library" onPress={() => onPick('library')} />
        {hasPhoto && (
          <>
            <Divider />
            <Row icon="trash-outline" label="Remove photo" destructive onPress={onRemove} />
          </>
        )}
      </SheetScrollView>
    </Sheet>
  );
}

function Row({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: destructive ? colors.dangerSurface : colors.surfaceMuted },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={destructive ? colors.danger : colors.textSecondary}
        />
      </View>
      <Text variant="body" style={destructive ? { color: colors.danger } : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A short list sizes to its content instead of stretching the sheet.
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    // Taller than `OptionList`'s rows by the icon disc they carry.
    minHeight: controlHeight.md + spacing.sm,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
