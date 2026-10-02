export type QuarterTurns = 0 | 1 | 2 | 3;
type Point = readonly [number, number];

/** Display-only rotation of the EXIF-upright source; native processing still receives the unchanged source quad. */
export function rotatedPreview(width: number, height: number, turns: QuarterTurns) {
  const transforms = [
    'matrix(1 0 0 1 0 0)',
    `matrix(0 1 -1 0 ${height} 0)`,
    `matrix(-1 0 0 -1 ${width} ${height})`,
    `matrix(0 -1 1 0 0 ${width})`,
  ];
  return { width: turns % 2 ? height : width, height: turns % 2 ? width : height, transform: transforms[turns] };
}

export function sourceToDisplay([x, y]: Point, turns: QuarterTurns): Point {
  switch (turns) {
    case 0: return [x, y];
    case 1: return [1 - y, x];
    case 2: return [1 - x, 1 - y];
    case 3: return [y, 1 - x];
  }
}

export function displayToSource([x, y]: Point, turns: QuarterTurns): Point {
  switch (turns) {
    case 0: return [x, y];
    case 1: return [y, 1 - x];
    case 2: return [1 - x, 1 - y];
    case 3: return [1 - y, x];
  }
}

/** Corner labels follow their visible position while the stored quad retains its original order. */
export function sourceCorner(displayCorner: number, turns: QuarterTurns) {
  return (displayCorner - turns + 4) % 4;
}
