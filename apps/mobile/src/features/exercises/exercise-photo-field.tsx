/**
 * The photo row at the top of the new-exercise form.
 *
 * A tile the size a thumbnail is never drawn at, with what it is for beside it.
 * Empty, it is a dashed outline and a camera: a slot, not a picture. Filled, it
 * is the picture, with a small pencil to say it can still be changed.
 *
 * The whole row is one target. The tile alone would be an 80pt button with its
 * own explanation sitting inert next to it.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { radius, spacing, stroke, useColors } from '@/theme';

const TILE = 80;
const BADGE = 26;

export interface ExercisePhotoFieldProps {
  /** A loadable URI for the chosen picture, or null when there is none yet. */
  uri: string | null;
  onPress: () => void;
}

export function ExercisePhotoField({ uri, onPress }: ExercisePhotoFieldProps) {
  const colors = useColors();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={uri ? 'Change photo' : 'Add photo'}
      accessibilityHint="Take a photo or choose one from your library"
      onPress={onPress}
      style={styles.row}
    >
      <View>
        {uri ? (
          <Image
            source={{ uri }}
            style={[styles.tile, { backgroundColor: colors.mediaPlate }]}
            contentFit="cover"
            transition={120}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={[
              styles.tile,
              styles.empty,
              { backgroundColor: colors.surface, borderColor: colors.borderStrong },
            ]}
          >
            <Ionicons name="camera-outline" size={26} color={colors.textSecondary} />
          </View>
        )}

        {uri && (
          // Ringed in the canvas colour so it reads as sitting on the corner of
          // the tile rather than as part of the photograph.
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.background },
            ]}
          >
            <Ionicons name="pencil" size={12} color={colors.text} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text variant="bodyMedium">{uri ? 'Change photo' : 'Add photo'}</Text>
        <Text variant="caption" color="textTertiary">
          Optional. Shown in search and during your workouts, so the machine is recognisable at a
          glance.
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  tile: { width: TILE, height: TILE, borderRadius: radius.lg },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke.outline,
    borderStyle: 'dashed',
  },
  badge: {
    position: 'absolute',
    right: -spacing.xs,
    bottom: -spacing.xs,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
});
