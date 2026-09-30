/**
 * The demonstration clip, without leaving the logging screen.
 *
 * Tapping the still on the session opens this sheet and the clip starts on
 * its own: the tap already asked for the demo. Same player as the exercise
 * page (`ExerciseMedia`). YouTube sits on the artwork.
 */

import { StyleSheet } from 'react-native';

import { Sheet, SheetScrollView } from '@/components/ui';
import { spacing } from '@/theme';

import { ExerciseMedia } from './exercise-media';

export interface ExerciseDemoSheetProps {
  visible: boolean;
  onClose: () => void;
  name: string;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  /** The user's own photo, as stored. Shown as the still when there is one. */
  photo?: string | null;
}

export function ExerciseDemoSheet({
  visible,
  onClose,
  name,
  thumbnailUrl,
  videoUrl,
  photo,
}: ExerciseDemoSheetProps) {
  return (
    <Sheet
      visible={visible}
      label={name}
      closeLabel={`Close ${name} demonstration`}
      onClose={onClose}
    >
      <SheetScrollView contentContainerStyle={styles.content}>
        <ExerciseMedia
          name={name}
          thumbnailUrl={thumbnailUrl}
          videoUrl={videoUrl}
          photo={photo}
          autoplay
        />
      </SheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
