/**
 * Where a user's own photo of an exercise lives, and how the stored value is
 * read back.
 *
 * The row keeps a path *relative* to the app's document directory in
 * `image_url`, never the absolute one. The absolute path is a property of one
 * install: iOS moves the container on every update, and the column replicates,
 * so an absolute path would be wrong on the next launch on one platform and on
 * every other device on both.
 *
 * Pure on purpose. The file work is `features/exercises/photo.ts` in the app;
 * what is here is the part that decides which strings are acceptable, and that
 * is worth being able to test without a phone.
 */

export const EXERCISE_PHOTO_DIR = 'exercise-photos';

/**
 * One path segment under the photo directory, and nothing else.
 *
 * Strict because the value is not only ever written by `exercisePhotoPath`: a
 * custom exercise's row comes back from the sync server, and a restored backup
 * is a file someone handed the app. Neither gets to name `../SQLite/lift.db`.
 */
const PHOTO_PATH = new RegExp(`^${EXERCISE_PHOTO_DIR}/[A-Za-z0-9_-]+\\.jpg$`);

const REMOTE_URL = /^https?:\/\//i;

/** The relative path a newly saved photo is stored under. `name` is a UUID. */
export function exercisePhotoPath(name: string): string {
  return `${EXERCISE_PHOTO_DIR}/${name}.jpg`;
}

/** True for a value this module wrote: a file the app owns and may delete. */
export function isExercisePhotoPath(stored: string | null | undefined): stored is string {
  return typeof stored === 'string' && PHOTO_PATH.test(stored);
}

/**
 * Turns the stored value into something an image view can load, or null.
 *
 * A remote URL passes through, which is what leaves room for photos hosted by
 * the sync server later. Anything else that is not one of our own paths is
 * refused rather than guessed at: `file:` and `content:` URIs only ever mean
 * something on the device that produced them.
 *
 * Resolving is not a promise the file exists. A photo taken on another phone
 * arrives as a path with nothing behind it, and the view that loads it has to
 * fall back when that fails.
 */
export function resolveExercisePhoto(
  stored: string | null | undefined,
  baseUri: string,
): string | null {
  if (!stored) return null;
  if (REMOTE_URL.test(stored)) return stored;
  if (!isExercisePhotoPath(stored)) return null;

  return `${baseUri.endsWith('/') ? baseUri : `${baseUri}/`}${stored}`;
}
