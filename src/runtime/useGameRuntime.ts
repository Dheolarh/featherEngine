import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { resetFrameClock, smoothFrameDelta } from './frameClock';
import { resetGamepadInput, sampleGamepads } from './gamepadInput';

export interface RuntimeLoopInstrumentation {
  onSessionStart?: () => void;
  onFrame?: (frameMs: number, tickMs: number) => void;
}

/**
 * The one frame/input driver used by editor Play and every exported Player. Keeping the shell here
 * means Blueprints, physics, gamepad and mouse/keyboard timing cannot drift between preview/build.
 */
export function useGameRuntime(active: boolean, instrumentation?: RuntimeLoopInstrumentation) {
  const tickRuntime = useEditorStore((state) => state.tickRuntime);
  const setRuntimeKey = useEditorStore((state) => state.setRuntimeKey);
  const instrumentationRef = useRef(instrumentation);
  instrumentationRef.current = instrumentation;

  useEffect(() => {
    if (!active) return;
    instrumentationRef.current?.onSessionStart?.();
    resetFrameClock();
    let frame = 0;
    let lastTime = performance.now();
    const loop = (time: number) => {
      const frameMs = time - lastTime;
      const delta = smoothFrameDelta(frameMs / 1000);
      lastTime = time;
      const tickStart = performance.now();
      sampleGamepads(delta, setRuntimeKey);
      tickRuntime(delta);
      instrumentationRef.current?.onFrame?.(frameMs, performance.now() - tickStart);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      resetGamepadInput();
    };
  }, [active, tickRuntime, setRuntimeKey]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.repeat) setRuntimeKey(event.code, true);
    };
    const onKeyUp = (event: KeyboardEvent) => setRuntimeKey(event.code, false);
    const onMouseDown = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, true);
    const onMouseUp = (event: MouseEvent) => setRuntimeKey(`Mouse${event.button}`, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [active, setRuntimeKey]);
}
