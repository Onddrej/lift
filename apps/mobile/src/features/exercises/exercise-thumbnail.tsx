import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui';
import { radius, useColors } from '@/theme';

import { exercisePhotoUri } from './photo-store';

/**
 * Two initials derived from the exercise name. Used when the catalog has no
 * artwork for a row (~6% of it) and for user-created exercises the user has
 * not photographed. Skips the parenthesised equipment qualifier so "Bench Press
 * (Barbell)" reads "BP", not "BB".
 */
export function initialsFor(name: string): string {
  const base = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export interface ExerciseThumbnailProps {
  name: string;
  /** Catalog artwork. */
  url?: string | null;
  /** The user's own photo: the row's `imageUrl`, as stored. Wins over `url`. */
  photo?: string | null;
  size?: number;
  /** Highlights the tile, for selected rows in a picker. */
  selected?: boolean;
  style?: ViewStyle;
}

export function ExerciseThumbnail({
  name,
  url,
  photo,
  size = 44,
  selected = false,
  style,
}: ExerciseThumbnailProps) {
  const colors = useColors();

  /*
   * A stored photo is a path, not a promise that the file is there. The column
   * replicates and the file does not, so a custom exercise photographed on
   * another phone arrives naming a picture this one has never had, and a
   * restored backup does the same. When it fails to load the tile falls back to
   * the catalog artwork, which is what it would have shown anyway.
   *
   * The failed URI is remembered rather than a flag. These tiles sit in a
   * `FlashList` that recycles views down the whole catalog, so a boolean set by
   * one row would still be set when the view came back as a different one.
   */
  const photoUri = exercisePhotoUri(photo);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showsPhoto = photoUri !== null && photoUri !== failedUri;

  const source = showsPhoto ? photoUri : url;

  const background = selected
    ? colors.accent
    : colors.mediaPlate;

  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius.md, backgroundColor: background },
        style,
      ]}
    >
      {source && !selected ? (
        <Image
          source={{ uri: source }}
          style={styles.image}
          // `contain` for the catalog, not `cover`: these are full-body figures,
          // and cropping one to a square tile reliably cuts off the head or the
          // barbell. A photo is the opposite case. It was cropped square by the
          // person who took it, and letterboxing it would show the plate behind
          // a picture that is meant to fill the tile.
          contentFit={showsPhoto ? 'cover' : 'contain'}
          // Disk-cached by expo-image, so a scroll back up the list is free
          // and the second launch does not re-fetch 6,800 thumbnails. A photo
          // is already a file on this disk; caching it there again would store
          // every one of them twice.
          cachePolicy={showsPhoto ? 'memory' : 'disk'}
          transition={120}
          onError={showsPhoto ? () => setFailedUri(photoUri) : undefined}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          variant="label"
          style={{ color: selected ? colors.textOnAccent : '#111114' }}
        >
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
