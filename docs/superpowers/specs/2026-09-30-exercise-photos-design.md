# Exercise photos

Let the user attach their own photo to any exercise, taken with the camera or
picked from the gallery, and show it everywhere the exercise's artwork appears.

## Why

Hevy gates custom exercise images behind Pro. The point of a photo is
recognition in the picker mid-workout: "the chest press in *my* gym" is a
machine, not a name. Approved with the user on 2026-09-30 for **all** exercises,
built-in and custom.

## Behaviour

- **Precedence:** user photo, then catalog thumbnail, then the initials tile.
- **Where it shows:** every `ExerciseThumbnail` (library, picker, active
  workout, history, stats) and the still in `ExerciseMedia`. A catalog clip
  stays playable behind a user photo.
- **Where it is set:**
  - New exercise form: a photo tile above the name.
  - Exercise detail: a chip on the media panel, bottom right, mirroring the
    YouTube chip at top right. Reads "Add photo" or "Change photo".
  - Both open one sheet: Take photo, Choose from library, Remove photo (only
    when one is set).
- **Native only.** Hidden on the web build, which has no file store to keep the
  image in.

## Storage

- The image is cropped square in the system picker, resized to 1024 px on the
  long edge and saved as JPEG at 0.8. A 12 MP camera frame is 3-5 MB; this is
  ~150 KB and the 44 pt list tile is what it is mostly drawn at.
- Files live in `Paths.document/exercise-photos/<uuid>.jpg`. A fresh name per
  save, so `expo-image`'s cache never serves the previous picture.
- The row stores a **relative** path in the existing, unused `image_url`
  column (`exercise-photos/<uuid>.jpg`). No migration. Relative because the
  absolute container path is not stable across reinstalls on iOS.
- A value with a URI scheme (`https:`) is passed through untouched, which
  leaves room for server-hosted images later.
- Replacing or removing a photo deletes the old file. Deleting a custom
  exercise deletes its photo.

## Sync and backup

`image_url` already replicates for custom exercises and is already in the JSON
backup. The file itself does not travel, so on another device the path resolves
to nothing: the image fails to load and the tile falls back to the catalog
thumbnail or initials. Built-in exercises never sync, so a photo on one is local
to the phone, the same rule the per-exercise unit override follows.

Uploading the file to the sync server is out of scope.

## Units

| Unit | Responsibility |
|---|---|
| `packages/shared/src/exercises/photo.ts` | Pure: build a relative path, recognise one, resolve a stored value against a base URI. Refuses anything that is not a photo path or a remote URL. Unit tested. |
| `apps/mobile/src/features/exercises/photo-store.ts` | Disk: resolve a stored value to a URI, resize and write, delete. |
| `apps/mobile/src/features/exercises/photo-picker.ts` | Camera permission and the system picker. Separate so the repository can delete a photo without importing the picker. |
| `apps/mobile/src/features/exercises/exercise-photo-sheet.tsx` | The three-row sheet. |
| `apps/mobile/src/features/exercises/exercise-photo-field.tsx` | The photo row on the new-exercise form. |
| `apps/mobile/src/features/exercises/use-exercise-photo-picker.ts` | Glue: sheet state, run a pick, surface a denial or a failure. |
| `exercise-thumbnail.tsx`, `exercise-media.tsx` | Take the stored value as `photo`; it wins over the catalog art and falls back to it on a load error. The tile draws it `cover`. |
| `repository.ts` | `imageUrl` on create, `setExercisePhoto`, photo cleanup on delete. |

## Permissions

- Gallery: none. Android 13+ uses the system Photo Picker.
- Camera: requested on first use. A denial that can no longer be re-asked
  offers "Open settings".

## Errors

- Cancelled pick: nothing happens.
- Save fails (disk full, source unreadable): dialog, row untouched.
- Insert fails after the file was written on the new-exercise form: the file is
  deleted so nothing is orphaned.

## Not handled

- Android killing the activity while the camera app is open
  (`getPendingResultAsync`). The pick is lost and has to be retaken.
- Web.

## Fork housekeeping (separate change)

- OTA updates off: the fork must not take bundles from the upstream EAS project.
- Android package id changed from `com.lift.app`, so the fork and the official
  build cannot install over each other.
