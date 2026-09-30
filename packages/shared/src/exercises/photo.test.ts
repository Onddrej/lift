import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exercisePhotoPath, isExercisePhotoPath, resolveExercisePhoto } from './photo.ts';

const BASE = 'file:///data/user/0/app/files/';

describe('exercisePhotoPath', () => {
  it('names a jpeg inside the photo directory', () => {
    assert.equal(exercisePhotoPath('0192-abc'), 'exercise-photos/0192-abc.jpg');
  });

  it('produces a path that reads back as one of its own', () => {
    assert.equal(isExercisePhotoPath(exercisePhotoPath('0192-abc')), true);
  });
});

describe('isExercisePhotoPath', () => {
  it('rejects anything outside the photo directory', () => {
    assert.equal(isExercisePhotoPath('SQLite/lift.db'), false);
    assert.equal(isExercisePhotoPath('exercise-photos/../SQLite/lift.db'), false);
    assert.equal(isExercisePhotoPath('exercise-photos/nested/a.jpg'), false);
    assert.equal(isExercisePhotoPath('/exercise-photos/a.jpg'), false);
  });

  it('rejects remote urls and empty values', () => {
    assert.equal(isExercisePhotoPath('https://cdn.example.com/a.jpg'), false);
    assert.equal(isExercisePhotoPath(''), false);
    assert.equal(isExercisePhotoPath(null), false);
    assert.equal(isExercisePhotoPath(undefined), false);
  });
});

describe('resolveExercisePhoto', () => {
  it('returns null when nothing is stored', () => {
    assert.equal(resolveExercisePhoto(null, BASE), null);
    assert.equal(resolveExercisePhoto(undefined, BASE), null);
    assert.equal(resolveExercisePhoto('', BASE), null);
  });

  it('joins a stored photo path onto the base', () => {
    assert.equal(
      resolveExercisePhoto('exercise-photos/a.jpg', BASE),
      'file:///data/user/0/app/files/exercise-photos/a.jpg',
    );
  });

  it('adds the separator a base without a trailing slash is missing', () => {
    assert.equal(
      resolveExercisePhoto('exercise-photos/a.jpg', 'file:///files'),
      'file:///files/exercise-photos/a.jpg',
    );
  });

  it('passes a remote url through untouched', () => {
    assert.equal(
      resolveExercisePhoto('https://cdn.example.com/a.jpg', BASE),
      'https://cdn.example.com/a.jpg',
    );
  });

  // The column replicates, so the value can arrive from a server rather than
  // from this module. It must not be able to name a file outside the directory.
  it('refuses a relative path that is not a photo path', () => {
    assert.equal(resolveExercisePhoto('exercise-photos/../SQLite/lift.db', BASE), null);
    assert.equal(resolveExercisePhoto('SQLite/lift.db', BASE), null);
  });

  it('refuses local schemes, which only this device could have written', () => {
    assert.equal(resolveExercisePhoto('file:///etc/hosts', BASE), null);
    assert.equal(resolveExercisePhoto('content://media/1', BASE), null);
  });
});
