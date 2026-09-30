# Exercise Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a camera or gallery photo to any exercise and show it wherever the exercise's artwork appears.

**Architecture:** The row keeps a relative path in the existing `image_url` column; the file sits in the app's document directory. Pure path rules live in `@lift/shared` and are unit tested. Every thumbnail takes the stored value as a `photo` prop next to its catalog `url`, resolves it, and falls back to the catalog art when the file cannot be loaded.

**Tech Stack:** Expo SDK 57, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system` (`File`/`Directory`/`Paths`), `expo-image`, drizzle + expo-sqlite.

Spec: `docs/superpowers/specs/2026-09-30-exercise-photos-design.md`

---

### Task 1: Path rules (shared, TDD)

**Files:**
- Create: `packages/shared/src/exercises/photo.ts`, `packages/shared/src/exercises/photo.test.ts`
- Modify: `packages/shared/src/exercises/index.ts` (re-export)

- [x] Write `photo.test.ts` covering `exercisePhotoPath`, `isExercisePhotoPath`, `resolveExercisePhoto` (null, relative join, missing slash, remote passthrough, traversal refused, local schemes refused)
- [x] Run `node --test --experimental-strip-types src/exercises/photo.test.ts` in `packages/shared`, expect FAIL (module missing)
- [x] Implement `photo.ts`
- [x] Re-run, expect 10 passing
- [x] Re-export from `exercises/index.ts`, run `pnpm --filter @lift/shared build`

### Task 2: Native dependencies

**Files:**
- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`

- [x] `pnpm --filter @lift/mobile exec expo install expo-image-picker expo-image-manipulator`
- [x] Add the `expo-image-picker` config plugin to `app.json` with camera and photo permission strings
- [x] Read the installed `.d.ts` for both packages and confirm the calls Task 3 makes exist at this SDK

### Task 3: File work

**Files:**
- Create: `apps/mobile/src/features/exercises/photo-store.ts`, `apps/mobile/src/features/exercises/photo-picker.ts`

Interface:

```ts
// photo-store.ts
export const EXERCISE_PHOTOS_SUPPORTED: boolean;            // false on web
export interface PhotoSource { uri: string; width: number; height: number }
export function exercisePhotoUri(stored: string | null | undefined): string | null;
export function saveExercisePhoto(source: PhotoSource): Promise<string>;   // returns stored path
export function deleteExercisePhoto(stored: string | null | undefined): void;

// photo-picker.ts
export type PhotoOrigin = 'camera' | 'library';
export type PickResult =
  | { status: 'picked'; photo: PhotoSource }
  | { status: 'cancelled' }
  | { status: 'denied'; canAskAgain: boolean };
export function pickExercisePhoto(origin: PhotoOrigin): Promise<PickResult>;
```

- [x] `pickExercisePhoto`: camera permission on demand; square crop in the picker; images only
- [x] `saveExercisePhoto`: downscale to 1024 px on the long edge, JPEG 0.8, move into `Paths.document/exercise-photos/<uuidv7>.jpg`
- [x] `deleteExercisePhoto`: only deletes values `isExercisePhotoPath` accepts; never throws

### Task 4: Repository

**Files:**
- Modify: `apps/mobile/src/features/exercises/repository.ts`

- [x] `imageUrl` added to `ExerciseListItem`, `exerciseListColumns`, `CreateExerciseInput`
- [x] `createCustomExercise` stores `input.imageUrl ?? null`
- [x] New `setExercisePhoto(id, stored | null)`: writes the column, replicates custom rows, deletes the previous file
- [x] `deleteExercise` deletes the photo of a custom exercise

### Task 5: Display

**Files:**
- Modify: `exercise-thumbnail.tsx`, `exercise-media.tsx`, `exercise-demo-sheet.tsx`, `exercise-row.tsx`
- Modify call sites: `features/workouts/{exercise-block,collapsed-lift,exercise-set-list}.tsx`, `app/workout/{active,[id]}.tsx`, `app/stats/{leaderboard,main-exercises}.tsx`, `features/analytics/exercise-stats.ts`

- [x] `ExerciseThumbnail` gains `photo?: string | null`; resolved photo wins, `cover` fit, `onError` falls back to `url`
- [x] `ExerciseMedia` gains `photo` and `onEditPhoto`; draws the chip when `onEditPhoto` is given
- [x] Every call site passes `photo={…imageUrl}`; partial selects add `imageUrl`

### Task 6: Editing UI

**Files:**
- Create: `exercise-photo-sheet.tsx`, `use-exercise-photo-picker.ts`, `exercise-photo-field.tsx`
- Modify: `app/exercise/new.tsx`, `app/exercise/[id].tsx`

- [x] Sheet: Take photo, Choose from library, Remove photo (when set)
- [x] Hook: runs the pick, shows the denial dialog with "Open settings"
- [x] New exercise: photo tile above the name; file is written on save, deleted if the insert fails
- [x] Detail: chip on the media panel; state updates in place after a change

### Task 7: Fork housekeeping

**Files:**
- Modify: `apps/mobile/app.json`

- [x] `updates.enabled: false`, upstream URL removed
- [x] `android.package` and `ios.bundleIdentifier` changed

### Task 8: Verify

- [x] `pnpm --filter @lift/shared test`
- [x] `pnpm --filter @lift/shared build && pnpm --filter @lift/mobile typecheck`
- [x] `pnpm --filter @lift/mobile lint`
- [x] `node scripts/release.mjs check`
- [x] Web export of the exercise screens renders with no regressions; photo row, chip and sheet checked there with the web gate lifted temporarily
- [ ] On-device check is the APK from the Android workflow: cannot be run from this machine
