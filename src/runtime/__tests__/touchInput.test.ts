import { afterEach, describe, expect, it } from 'vitest';
import { gamepadInput, sampleGamepads } from '../gamepadInput';
import { resetTouchInput, touchInput } from '../touchInput';

// jsdom has no navigator.getGamepads, so sampleGamepads sees zero pads — exactly the
// situation on a phone, where touch must still drive the merged analog snapshot.
describe('touch input merge', () => {
  const noopSetKey = () => {};

  afterEach(() => {
    resetTouchInput();
    sampleGamepads(1 / 60, noopSetKey);
  });

  it('feeds the virtual stick into gamepadInput when active', () => {
    touchInput.active = true;
    touchInput.moveX = 0.6;
    touchInput.moveY = -0.4;
    sampleGamepads(1 / 60, noopSetKey);
    expect(gamepadInput.moveX).toBeCloseTo(0.6);
    expect(gamepadInput.moveY).toBeCloseTo(-0.4);
  });

  it('maps stick up/down to vehicle throttle/brake', () => {
    touchInput.active = true;
    touchInput.moveY = 0.8;
    sampleGamepads(1 / 60, noopSetKey);
    expect(gamepadInput.throttle).toBeCloseTo(0.8);
    expect(gamepadInput.brake).toBe(0);

    touchInput.moveY = -0.5;
    sampleGamepads(1 / 60, noopSetKey);
    expect(gamepadInput.throttle).toBe(0);
    expect(gamepadInput.brake).toBeCloseTo(0.5);
  });

  it('contributes nothing while inactive', () => {
    touchInput.active = false;
    touchInput.moveX = 1;
    sampleGamepads(1 / 60, noopSetKey);
    expect(gamepadInput.moveX).toBe(0);
    expect(gamepadInput.throttle).toBe(0);
  });

  it('does not mark a gamepad as connected', () => {
    touchInput.active = true;
    touchInput.moveX = 1;
    sampleGamepads(1 / 60, noopSetKey);
    expect(gamepadInput.connected).toBe(false);
  });
});
