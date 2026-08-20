import { describe, it, expect } from 'vitest';
import { COVER_MAX_EDGE, dataUrlByteLength, fitWithin } from '../coverImage';

/**
 * Cover art rides inside the package manifest AND gets copied into the store catalog, so it is
 * downloaded by everyone browsing — not just installers. These cover the sizing maths; the canvas
 * re-encode itself needs a real browser and is verified there.
 */

describe('fitWithin', () => {
  it('scales the longest edge down to the limit, preserving aspect', () => {
    expect(fitWithin(2048, 1024, COVER_MAX_EDGE)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(1024, 2048, COVER_MAX_EDGE)).toEqual({ width: 256, height: 512 });
  });

  it('never upscales a small image', () => {
    expect(fitWithin(64, 48, COVER_MAX_EDGE)).toEqual({ width: 64, height: 48 });
  });

  it('keeps an extreme aspect ratio at least one pixel tall', () => {
    // A 4000x3 banner must not round to zero height and produce an unusable canvas.
    const fitted = fitWithin(4000, 3, COVER_MAX_EDGE);
    expect(fitted.width).toBe(512);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });

  it('returns zero for degenerate input rather than NaN', () => {
    expect(fitWithin(0, 100, COVER_MAX_EDGE)).toEqual({ width: 0, height: 0 });
  });
});

describe('dataUrlByteLength', () => {
  it('measures the decoded size of a data URL', () => {
    // "hi" -> aGk= (2 bytes, one pad char)
    expect(dataUrlByteLength('data:text/plain;base64,aGk=')).toBe(2);
    // 3 bytes, no padding.
    expect(dataUrlByteLength('data:text/plain;base64,YWJj')).toBe(3);
    // 1 byte, two pad chars.
    expect(dataUrlByteLength('data:text/plain;base64,YQ==')).toBe(1);
  });

  it('is zero for a string that is not a data URL', () => {
    expect(dataUrlByteLength('nonsense')).toBe(0);
  });
});
