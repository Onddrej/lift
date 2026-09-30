/**
 * The files behind a user's own exercise photos.
 *
 * The rules for what may be stored are in `@lift/shared/exercises` (`photo.ts`),
 * where they can be tested without a phone. This is the half that touches the
 * disk: it turns whatever the camera or the gallery handed over into one small
 * JPEG the app owns, and removes it again when the row stops pointing at it.
 */

import { uuidv7 } from '@lift/shared';
import {
  EXERCISE_PHOTO_DIR,
  exercisePhotoPath,
  isExercisePhotoPath,
  resolveExercisePhoto,
} from '@lift/shared/exercises';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

/**
 * Whether this build has somewhere to keep a photo.
 *
 * The web build has no document directory that survives a reload, and a data
 * URI in `image_url` would put a few hundred kilobytes into every sync of that
 * row. The controls are hidden there instead.
 */
export const EXERCISE_PHOTOS_SUPPORTED = Platform.OS !== 'web';

/**
 * The longest edge a stored photo may have.
 *
 * A phone camera produces twelve megapixels and 3-5 MB. The picture is drawn at
 * 44pt in a list and at the width of the screen on one page, so 1024 is past
 * what any phone shows at 3x and comes to roughly 150 KB.
 */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

let documentUri: string | null = null;

/**
 * Something an image view can load for a stored `imageUrl`, or null.
 *
 * Called by every thumbnail on every render, and for all but a handful of the
 * catalog's 6,800 rows the answer is "nothing stored", so that case returns
 * before anything else is looked at.
 */
export function exercisePhotoUri(stored: string | null | undefined): string | null {
  if (!stored) return null;

  // No document directory to resolve against. A remote URL still passes.
  if (!EXERCISE_PHOTOS_SUPPORTED) {
    return isExercisePhotoPath(stored) ? null : resolveExercisePhoto(stored, '');
  }

  documentUri ??= Paths.document.uri;
  return resolveExercisePhoto(stored, documentUri);
}

export interface PhotoSource {
  uri: string;
  width: number;
  height: number;
}

/**
 * Copies a picked image into the app's own storage and returns the path to put
 * in `image_url`.
 *
 * The picker's file sits in the cache directory, which the system may empty at
 * any time, so the row never points at it. What is kept is a re-encoded copy
 * under a name nothing else has ever used: a fresh UUID per save, so replacing
 * a photo changes the URI and no image cache can serve the old picture for it.
 *
 * Downscales only. A small source is re-encoded at its own size rather than
 * blown up to fill an edge it never had.
 */
export async function saveExercisePhoto(source: PhotoSource): Promise<string> {
  const context = ImageManipulator.manipulate(source.uri);

  try {
    if (Math.max(source.width, source.height) > MAX_EDGE) {
      // One dimension only: the other follows, so the crop the user chose is
      // kept at whatever proportions it has.
      context.resize(
        source.width >= source.height ? { width: MAX_EDGE } : { height: MAX_EDGE },
      );
    }

    const rendered = await context.renderAsync();

    try {
      const encoded = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_QUALITY,
      });

      new Directory(Paths.document, EXERCISE_PHOTO_DIR).create({
        idempotent: true,
        intermediates: true,
      });

      const stored = exercisePhotoPath(uuidv7());
      await new File(encoded.uri).move(new File(exercisePhotoUri(stored)!));

      return stored;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

/**
 * Removes a stored photo's file.
 *
 * Only ever a path this module wrote: a remote URL has no file here, and
 * anything else in the column is not ours to delete. Never throws. This runs
 * after the row has already been changed, and a file that would not delete is
 * a few kilobytes left behind, not a reason to fail the edit that orphaned it.
 */
export function deleteExercisePhoto(stored: string | null | undefined): void {
  if (!EXERCISE_PHOTOS_SUPPORTED || !isExercisePhotoPath(stored)) return;

  try {
    const file = new File(exercisePhotoUri(stored)!);
    if (file.exists) file.delete();
  } catch {
    // See above.
  }
}
