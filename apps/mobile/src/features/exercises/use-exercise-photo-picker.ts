/**
 * The photo sheet's state and what happens when one of its rows is pressed.
 *
 * Shared by the two screens that can set a photo. They differ in what they do
 * with the picture (the detail screen saves it at once, the new-exercise form
 * holds it until the exercise exists), so that part is the caller's. What is
 * the same is everything before it: close the sheet, ask for the camera if it
 * is the camera, open the picker, and say so plainly when any of that fails.
 */

import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { showAlert, showDialog } from '@/store/dialog';

import { pickExercisePhoto, type PhotoOrigin } from './photo-picker';
import type { PhotoSource } from './photo-store';

/**
 * How long iOS needs to finish taking the sheet down.
 *
 * UIKit will not present the picker from a view controller that is still
 * dismissing another one: the call returns, nothing appears, and no error says
 * why. Android starts the picker as a separate activity and has no such rule,
 * so it does not wait.
 */
const IOS_DISMISS_MS = 350;

export interface ExercisePhotoPicker {
  sheetVisible: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  /** Closes the sheet and runs the pick. Pass to `ExercisePhotoSheet.onPick`. */
  pick: (origin: PhotoOrigin) => void;
}

export function useExercisePhotoPicker(
  onPicked: (photo: PhotoSource) => void | Promise<void>,
): ExercisePhotoPicker {
  const [sheetVisible, setSheetVisible] = useState(false);

  const pick = (origin: PhotoOrigin) => {
    setSheetVisible(false);

    void (async () => {
      if (Platform.OS === 'ios') {
        await new Promise((resolve) => setTimeout(resolve, IOS_DISMISS_MS));
      }

      try {
        const result = await pickExercisePhoto(origin);

        if (result.status === 'denied') {
          explainDenial(result.canAskAgain);
          return;
        }

        if (result.status === 'picked') await onPicked(result.photo);
      } catch (error) {
        // No camera on the device, a picker that failed to start, or the
        // caller's save throwing: a full disk, an unreadable source.
        void showAlert('Could not add photo', (error as Error).message);
      }
    })();
  };

  return {
    sheetVisible,
    openSheet: () => setSheetVisible(true),
    closeSheet: () => setSheetVisible(false),
    pick,
  };
}

/**
 * Says what was refused and, once the system will no longer ask, where to undo
 * it. A second "Allow?" prompt is not available at that point, and a button
 * that silently does nothing is the alternative.
 */
function explainDenial(canAskAgain: boolean): void {
  if (canAskAgain) {
    void showAlert('Camera access needed', 'Allow camera access to take a photo of this exercise.');
    return;
  }

  void showDialog({
    title: 'Camera access is off',
    message: 'Turn on camera access in Settings to take a photo, or choose one from your library.',
    actions: [
      { label: 'Not now', style: 'cancel' },
      { label: 'Open settings', onPress: () => void Linking.openSettings() },
    ],
  });
}
