import { describe, expect, it } from 'vitest';
import { displayToSource, rotatedPreview, sourceCorner, sourceToDisplay, type QuarterTurns } from './preview-geometry';
describe('upright source versus rotated display coordinates', () => {
  const expected = [[.2,.35], [.65,.2], [.8,.65], [.35,.8]] as const;
  it.each([0,1,2,3] as QuarterTurns[])('rotates and inverse-maps display pointers at %i quarter turns', turns => {
    const shown = sourceToDisplay([.2,.35], turns);
    expect(shown[0]).toBeCloseTo(expected[turns][0]); expect(shown[1]).toBeCloseTo(expected[turns][1]);
    const source = displayToSource(expected[turns], turns);
    expect(source[0]).toBeCloseTo(.2); expect(source[1]).toBeCloseTo(.35);
  });
  it.each([0,1,2,3] as QuarterTurns[])('uses the same rotation for SVG pixels and normalized positions at %i turns', turns => {
    const display = rotatedPreview(300, 400, turns);
    const [a,b,c,d,e,f] = display.transform.slice(7,-1).split(' ').map(Number);
    expect(a * 60 + c * 140 + e).toBeCloseTo(expected[turns][0] * display.width);
    expect(b * 60 + d * 140 + f).toBeCloseTo(expected[turns][1] * display.height);
    expect([display.width, display.height]).toEqual(turns % 2 ? [400,300] : [300,400]);
  });
  it('keeps screen corner names clockwise without reordering the stored source quad', () => {
    expect([0,1,2,3].map(i => sourceCorner(i, 1))).toEqual([3,0,1,2]);
    expect([0,1,2,3].map(i => sourceCorner(i, 2))).toEqual([2,3,0,1]);
    expect([0,1,2,3].map(i => sourceCorner(i, 3))).toEqual([1,2,3,0]);
    expect([0,1,2,3].map(i => sourceCorner(i, 0))).toEqual([0,1,2,3]);
  });
});
