/**
 * The Lift mark, drawn rather than shipped as a picture: stem, bar and plate,
 * with the plate's halo cut out of the other two so the shapes stay apart.
 *
 * Same geometry as `scripts/generate-brand.sh` and the report PDF, in the same
 * 100-unit space, so the mark on a screen and the one on the app icon are one
 * drawing. The seam is painted in `background`, which is what the original's
 * mask reveals wherever the mark sits on a flat colour.
 */

import Svg, { Rect } from 'react-native-svg';

export interface LiftMarkProps {
  /** Height in points. The width follows. */
  size: number;
  color: string;
  /** The colour the mark sits on, for the seam between plate and bar. */
  background: string;
}

const VIEW = { x: 16, y: 8, width: 64, height: 89 };

export function LiftMark({ size, color, background }: LiftMarkProps) {
  return (
    <Svg
      width={(size * VIEW.width) / VIEW.height}
      height={size}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      accessibilityRole="image"
      accessibilityLabel="Lift"
    >
      <Rect x={16} y={8} width={22} height={68} rx={7.5} fill={color} />
      <Rect x={16} y={54} width={62} height={22} rx={7.5} fill={color} />
      <Rect x={52.5} y={29.5} width={31} height={71} rx={12} fill={background} />
      <Rect x={56} y={33} width={24} height={64} rx={8.5} fill={color} />
    </Svg>
  );
}
