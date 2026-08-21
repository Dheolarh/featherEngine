import { describe, expect, it } from 'vitest';
import {
  advanceTimelineTime,
  decodeTimelineCurve,
  encodeTimelineCurve,
  normalizeTimelineCurve,
  sampleTimelineCurve,
  timelineCurvePreset,
} from '../timelineCurve';

describe('Timeline curves', () => {
  it('samples linear, hold, and smooth cubic segments', () => {
    expect(sampleTimelineCurve(timelineCurvePreset('linear'), 0.25)).toBeCloseTo(0.25);
    expect(sampleTimelineCurve(timelineCurvePreset('smooth'), 0.5)).toBeCloseTo(0.5);
    expect(sampleTimelineCurve(timelineCurvePreset('smooth'), 0.25)).toBeCloseTo(0.15625);
    expect(
      sampleTimelineCurve(
        [
          { id: 'a', time: 0, value: 2, interpolation: 'hold' },
          { id: 'b', time: 1, value: 8, interpolation: 'linear' },
        ],
        0.9,
      ),
    ).toBe(2);
  });

  it('supports overshoot and sanitizes malformed project data', () => {
    const keys = normalizeTimelineCurve([
      { id: 'late', time: 2, value: 1.4, interpolation: 'cubic', inTangent: Number.NaN },
      { id: 'early', time: -2, value: -0.2, interpolation: 'linear' },
    ]);
    expect(keys.map((item) => item.time)).toEqual([0, 1]);
    expect(keys[1].inTangent).toBe(0);
    expect(sampleTimelineCurve(keys, 1)).toBeCloseTo(1.4);
  });

  it('round-trips the compact FeatherScript curve representation', () => {
    const source = [
      { id: 'a', time: 0, value: 0, interpolation: 'cubic' as const, outTangent: 0 },
      { id: 'middle', time: 0.4, value: 1.2, interpolation: 'linear' as const, inTangent: 2, outTangent: -0.5 },
      { id: 'b', time: 1, value: 1, interpolation: 'cubic' as const, inTangent: 0 },
    ];
    const decoded = decodeTimelineCurve(encodeTimelineCurve(source));
    expect(decoded?.map(({ time, value, interpolation, inTangent, outTangent }) => ({ time, value, interpolation, inTangent, outTangent }))).toEqual(
      source.map(({ time, value, interpolation, inTangent, outTangent }) => ({ time, value, interpolation, inTangent, outTangent })),
    );
  });

  it('advances one-shot, looping, ping-pong, large, and paused steps deterministically', () => {
    expect(advanceTimelineTime(0.8, 0.4, 1, false, false)).toEqual({ time: 1, direction: 1, finished: true });
    expect(advanceTimelineTime(0.8, 0.4, 1, true, false).time).toBeCloseTo(0.2);
    const bounced = advanceTimelineTime(0.8, 0.4, 1, true, true);
    expect(bounced.time).toBeCloseTo(0.8);
    expect(bounced.direction).toBe(-1);
    expect(bounced.finished).toBe(false);
    const continuingBackward = advanceTimelineTime(
      bounced.time,
      0.2,
      1,
      true,
      true,
      bounced.direction,
    );
    expect(continuingBackward.time).toBeCloseTo(0.6);
    expect(continuingBackward.direction).toBe(-1);
    const largeStep = advanceTimelineTime(0.2, 5.4, 1, true, true);
    expect(largeStep.time).toBeCloseTo(0.4);
    expect(largeStep.direction).toBe(-1);
    expect(advanceTimelineTime(0.4, 0, 1, false, false)).toEqual({ time: 0.4, direction: 1, finished: false });
  });
});
