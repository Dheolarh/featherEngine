import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { CinematicLook, CinematicTextStyle, RuntimeCinematicFade, RuntimeCinematicText } from '../types';

/** Layout + typography for each on-screen text style. `position` anchors the block within the frame. */
const textStyleLayout: Record<CinematicTextStyle, { position: CSSProperties; text: CSSProperties }> = {
  subtitle: {
    position: { left: 0, right: 0, bottom: '9%', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(14px, 2.6vw, 30px)', fontWeight: 500, textShadow: '0 2px 8px rgba(0,0,0,0.85)', padding: '0 8%' },
  },
  title: {
    position: { left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(28px, 6vw, 76px)', fontWeight: 800, letterSpacing: '0.04em', textShadow: '0 4px 18px rgba(0,0,0,0.7)' },
  },
  lowerThird: {
    position: { left: '6%', right: '6%', bottom: '14%', alignItems: 'flex-start', textAlign: 'left' },
    text: { fontSize: 'clamp(16px, 3vw, 38px)', fontWeight: 700, textShadow: '0 2px 10px rgba(0,0,0,0.8)', borderLeft: '4px solid currentColor', paddingLeft: '0.5em' },
  },
  credit: {
    position: { left: 0, right: 0, bottom: '16%', alignItems: 'center', textAlign: 'center' },
    text: { fontSize: 'clamp(13px, 2.2vw, 26px)', fontWeight: 400, letterSpacing: '0.08em', textShadow: '0 2px 8px rgba(0,0,0,0.8)' },
  },
};

// This overlay is shared by editor Play and the standalone player. The player deliberately does not
// import the editor's multi-thousand-line stylesheet, so every essential visual rule lives here.
const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 25,
  pointerEvents: 'none',
  overflow: 'hidden',
};
const fillStyle: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };
const fadeStyle: CSSProperties = { ...fillStyle, zIndex: 6 };
const barStyle: CSSProperties = { position: 'absolute', background: '#000', zIndex: 5 };
const vignetteStyle: CSSProperties = {
  ...fillStyle,
  zIndex: 2,
  background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.9) 130%)',
};
const grainStyle: CSSProperties = {
  position: 'absolute',
  inset: '-50%',
  zIndex: 3,
  pointerEvents: 'none',
  mixBlendMode: 'overlay',
  backgroundImage:
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
  backgroundSize: '180px 180px',
  animation: 'nodeforge-cinematic-grain-shift 0.5s steps(3) infinite',
};
const lightLeakStyle: CSSProperties = {
  position: 'absolute',
  inset: '-30%',
  zIndex: 3,
  pointerEvents: 'none',
  mixBlendMode: 'screen',
  background:
    'radial-gradient(40% 70% at 12% 30%, rgba(255, 138, 76, 0.55), transparent 60%), radial-gradient(50% 60% at 90% 75%, rgba(255, 96, 140, 0.4), transparent 65%), linear-gradient(115deg, transparent 40%, rgba(255, 196, 120, 0.28) 50%, transparent 60%)',
  backgroundRepeat: 'no-repeat',
  animation: 'nodeforge-cinematic-leak-drift 13s ease-in-out infinite alternate',
};
const selfContainedAnimationCss = `
@keyframes nodeforge-cinematic-grain-shift {
  0% { transform: translate(0, 0); }
  33% { transform: translate(-6%, 4%); }
  66% { transform: translate(4%, -5%); }
  100% { transform: translate(-3%, 2%); }
}
@keyframes nodeforge-cinematic-leak-drift {
  0% { transform: translate(0, 0) scale(1); opacity: 0.85; }
  50% { transform: translate(4%, -3%) scale(1.08); opacity: 1; }
  100% { transform: translate(-3%, 4%) scale(1.02); opacity: 0.7; }
}
@media (prefers-reduced-motion: reduce) {
  .cinematic-grain, .cinematic-light-leak { animation: none !important; }
}`;

/** clip-path for a wipe that covers `cov` (0–1) of the frame, entering from the given direction. */
const wipeClip = (dir: NonNullable<RuntimeCinematicFade['wipe']>, cov: number): string => {
  const rest = `${((1 - cov) * 100).toFixed(2)}%`;
  switch (dir) {
    case 'right': return `inset(0 ${rest} 0 0)`; // colour grows from the left edge rightward
    case 'left': return `inset(0 0 0 ${rest})`; // grows from the right edge leftward
    case 'down': return `inset(0 0 ${rest} 0)`; // grows from the top downward
    case 'up': return `inset(${rest} 0 0 0)`; // grows from the bottom upward
  }
};

/**
 * The cinematic "film look" + fade layer rendered over the frame. Defaults to the live runtime
 * cinematic (player + editor Play); pass explicit `look`/`fade` to drive it from the editor scrub
 * preview. Renders letterbox bars (measured to the container so 2.35/1.85 are pixel-accurate),
 * a color grade, film grain, an extra vignette, and the fade-to/from-color. Fills its positioned
 * parent (`.scene-drop-zone` in the editor, the window in the player) and never eats pointer events.
 */
export function CinematicOverlay({ look: lookProp, fade: fadeProp, text: textProp }: { look?: CinematicLook; fade?: RuntimeCinematicFade; text?: RuntimeCinematicText[] } = {}) {
  const runtimeLook = useEditorStore((state) => state.runtimeCinematicLook);
  const runtimeFade = useEditorStore((state) => state.runtimeCinematicFade);
  const runtimeScreenFade = useEditorStore((state) => state.runtimeScreenFade);
  const runtimeText = useEditorStore((state) => state.runtimeCinematicText);
  const previewText = useEditorStore((state) => state.editorCinematicPreviewText);
  const screenFadeOverlay: RuntimeCinematicFade | undefined =
    runtimeScreenFade && runtimeScreenFade.opacity > 0.001
      ? { opacity: runtimeScreenFade.opacity, color: runtimeScreenFade.color }
      : undefined;
  const look = lookProp ?? runtimeLook;
  // Gameplay Screen Fade merges under cinematic fade (cinematic wins when both active).
  const fade = fadeProp ?? runtimeFade ?? screenFadeOverlay;
  const text = textProp ?? runtimeText ?? previewText;
  const aspect = look?.letterbox ?? 0;

  const ref = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || !aspect || aspect <= 0) {
      setBars({ x: 0, y: 0 });
      return;
    }
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (w / h > aspect) setBars({ x: Math.max(0, (w - h * aspect) / 2), y: 0 }); // pillarbox
      else setBars({ x: 0, y: Math.max(0, (h - w / aspect) / 2) }); // letterbox
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);

  const hasFade = Boolean(fade && fade.opacity > 0.001);
  const hasText = Boolean(text && text.length);
  // Note: the color grade is rendered as a post-processing shader on the cinematic camera (PostFx),
  // not here — this DOM layer only owns letterbox bars, grain, vignette, text, and the fade.
  const hasLook = Boolean(aspect > 0 || look?.grain || look?.vignette || look?.lightLeak);
  if (!hasLook && !hasFade && !hasText) return null;

  return (
    <div ref={ref} className="cinematic-overlay" style={overlayStyle}>
      <style>{selfContainedAnimationCss}</style>
      {look?.lightLeak ? (
        <div className="cinematic-light-leak" style={{ ...lightLeakStyle, opacity: Math.min(0.9, look.lightLeak) }} />
      ) : null}
      {look?.vignette ? (
        <div className="cinematic-look-vignette" style={{ ...vignetteStyle, opacity: Math.min(1, look.vignette) }} />
      ) : null}
      {look?.grain ? (
        <div className="cinematic-grain" style={{ ...grainStyle, opacity: Math.min(0.85, look.grain) }} />
      ) : null}
      {bars.y > 0 && (
        <>
          <div className="cinematic-bar" style={{ ...barStyle, top: 0, left: 0, right: 0, height: bars.y }} />
          <div className="cinematic-bar" style={{ ...barStyle, bottom: 0, left: 0, right: 0, height: bars.y }} />
        </>
      )}
      {bars.x > 0 && (
        <>
          <div className="cinematic-bar" style={{ ...barStyle, top: 0, bottom: 0, left: 0, width: bars.x }} />
          <div className="cinematic-bar" style={{ ...barStyle, top: 0, bottom: 0, right: 0, width: bars.x }} />
        </>
      )}
      {hasText &&
        text!.map((entry) => {
          const layout = textStyleLayout[entry.style] ?? textStyleLayout.subtitle;
          return (
            <div
              key={entry.id}
              className="cinematic-text-line"
              style={{
                position: 'absolute',
                display: 'flex',
                flexDirection: 'column',
                opacity: entry.opacity,
                color: entry.color,
                zIndex: 4,
                pointerEvents: 'none',
                ...layout.position,
              }}
            >
              <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.2, ...layout.text }}>{entry.text}</span>
            </div>
          );
        })}
      {hasFade && (
        <div
          className="cinematic-fade-overlay"
          style={
            fade!.wipe
              ? // Directional wipe: a solid colour edge sweeps in; `opacity` is the coverage fraction.
                { ...fadeStyle, background: fade!.color, opacity: 1, clipPath: wipeClip(fade!.wipe, Math.min(1, Math.max(0, fade!.opacity))) }
              : { ...fadeStyle, background: fade!.color, opacity: Math.min(1, Math.max(0, fade!.opacity)) }
          }
        />
      )}
    </div>
  );
}
