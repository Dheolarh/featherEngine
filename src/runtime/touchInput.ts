/**
 * Touch input for Play mode — the on-screen virtual joystick + buttons (TouchControls overlay)
 * write into this module singleton, exactly like `gamepadInput` and `mouseLook`, so per-frame
 * touch tracking never churns the Zustand store.
 *
 * The snapshot is merged into `gamepadInput`'s analog values inside `sampleGamepads` (touch acts
 * as one more connected pad), which means every existing consumer — Get Move Input, the character
 * pass, vehicle steering — picks up touch with zero changes. Buttons don't live here: the overlay
 * fires them straight through `setRuntimeKey` with standard codes (Space, KeyE, Mouse0), and
 * camera drag adds to `mouseLook` directly, matching how a real mouse/gamepad reach the runtime.
 */
export const touchInput = {
  /** True while the TouchControls overlay is mounted (a touch device is playing). */
  active: false,
  /** Virtual left stick: right = +1, forward (stick up) = +1. */
  moveX: 0,
  moveY: 0,
};

export function resetTouchInput() {
  touchInput.active = false;
  touchInput.moveX = 0;
  touchInput.moveY = 0;
}

/** Whether this device should get on-screen touch controls. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || 'ontouchstart' in window;
}
