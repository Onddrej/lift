/**
 * Getting one image out of the camera or the gallery.
 *
 * Kept apart from `photo-store.ts` so the repository can delete a photo without
 * pulling the picker into its module graph.
 */

import * as ImagePicker from 'expo-image-picker';

import type { PhotoSource } from './photo-store';

export type PhotoOrigin = 'camera' | 'library';

export type PickResult =
  | { status: 'picked'; photo: PhotoSource }
  | { status: 'cancelled' }
  /** Camera access refused. `canAskAgain` is false once only Settings can undo it. */
  | { status: 'denied'; canAskAgain: boolean };

/**
 * Square, because the place this picture is looked at most is a square tile in
 * a list, and a crop chosen by the person who took it beats one imposed by
 * `contentFit` on every row afterwards.
 *
 * `quality: 1`: the file is re-encoded once on the way into storage, and
 * compressing it here as well would do that twice.
 */
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
  exif: false,
};

/**
 * Opens the camera or the gallery and returns the chosen image.
 *
 * The gallery asks for nothing: on Android 13 and later it is the system photo
 * picker, which hands over the one image the user taps and no access to the
 * rest. The camera does need a grant, requested here at the moment it is first
 * wanted rather than at launch, which is the only point at which the reason for
 * asking is on screen.
 */
export async function pickExercisePhoto(origin: PhotoOrigin): Promise<PickResult> {
  if (origin === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }
  }

  const result =
    origin === 'camera'
      ? await ImagePicker.launchCameraAsync(OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(OPTIONS);

  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'cancelled' };

  return {
    status: 'picked',
    photo: { uri: asset.uri, width: asset.width, height: asset.height },
  };
}
