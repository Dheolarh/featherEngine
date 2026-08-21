import { useEffect, useMemo, useState } from 'react';
import type { TimelineCurveKey } from '../types';
import {
  normalizeTimelineCurve,
  sampleTimelineCurve,
  timelineCurvePreset,
  type TimelineCurvePreset,
} from '../runtime/timelineCurve';
import { makeId } from '../store/editor/ids';

const WIDTH = 320;
const HEIGHT = 176;
const PAD_X = 28;
const PAD_Y = 18;
const GRAPH_W = WIDTH - PAD_X * 2;
const GRAPH_H = HEIGHT - PAD_Y * 2;

interface TimelineCurveEditorProps {
  value: readonly TimelineCurveKey[] | undefined;
  onChange: (keys: TimelineCurveKey[]) => void;
}

const displayNumber = (value: number) => Number(value.toFixed(3));

export function TimelineCurveEditor({ value, onChange }: TimelineCurveEditorProps) {
  const keys = useMemo(() => normalizeTimelineCurve(value), [value]);
  const [selectedId, setSelectedId] = useState(keys[0]?.id ?? '');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const selected = keys.find((item) => item.id === selectedId) ?? keys[0];

  useEffect(() => {
    if (!keys.some((item) => item.id === selectedId)) setSelectedId(keys[0]?.id ?? '');
  }, [keys, selectedId]);

  const range = useMemo(() => {
    const samples = Array.from({ length: 81 }, (_, index) => sampleTimelineCurve(keys, index / 80));
    const values = [...keys.map((item) => item.value), ...samples, 0, 1];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const padding = Math.max(0.08, (high - low) * 0.12);
    return { min: low - padding, max: high + padding };
  }, [keys]);

  const pointFor = (time: number, keyValue: number) => ({
    x: PAD_X + Math.min(1, Math.max(0, time)) * GRAPH_W,
    y: PAD_Y + (1 - (keyValue - range.min) / Math.max(0.0001, range.max - range.min)) * GRAPH_H,
  });

  const valueAtPointer = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT;
    return {
      time: Math.min(1, Math.max(0, (x - PAD_X) / GRAPH_W)),
      value: range.max - Math.min(1, Math.max(0, (y - PAD_Y) / GRAPH_H)) * (range.max - range.min),
    };
  };

  const commit = (next: TimelineCurveKey[]) => onChange(normalizeTimelineCurve(next));
  const patchKey = (id: string, patch: Partial<TimelineCurveKey>) =>
    commit(keys.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const path = useMemo(
    () =>
      Array.from({ length: 121 }, (_, index) => {
        const time = index / 120;
        const point = pointFor(time, sampleTimelineCurve(keys, time));
        return `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      }).join(' '),
    // pointFor is intentionally derived from these primitives rather than memoized as a callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, range.min, range.max],
  );

  const applyPreset = (preset: TimelineCurvePreset) => {
    const next = timelineCurvePreset(preset).map((item) => ({ ...item, id: makeId('curve') }));
    setSelectedId(next[0].id);
    onChange(next);
  };

  return (
    <div className="timeline-curve-editor">
      <div className="timeline-curve-presets" aria-label="Timeline curve presets">
        <button type="button" onClick={() => applyPreset('smooth')}>Smooth</button>
        <button type="button" onClick={() => applyPreset('linear')}>Linear</button>
        <button type="button" onClick={() => applyPreset('easeIn')}>Ease in</button>
        <button type="button" onClick={() => applyPreset('easeOut')}>Ease out</button>
      </div>

      <svg
        className="timeline-curve-graph nodrag"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Timeline value curve. Drag keys or double-click to add one."
        onDoubleClick={(event) => {
          const nextPoint = valueAtPointer(event);
          const next: TimelineCurveKey = {
            id: makeId('curve'),
            time: nextPoint.time,
            value: nextPoint.value,
            interpolation: 'cubic',
            inTangent: 0,
            outTangent: 0,
          };
          setSelectedId(next.id);
          commit([...keys, next]);
        }}
        onPointerMove={(event) => {
          if (!draggingId) return;
          const next = valueAtPointer(event);
          patchKey(draggingId, { time: next.time, value: next.value });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setDraggingId(null);
        }}
        onPointerCancel={() => setDraggingId(null)}
      >
        <rect className="timeline-curve-bg" x={PAD_X} y={PAD_Y} width={GRAPH_W} height={GRAPH_H} rx="4" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const x = PAD_X + tick * GRAPH_W;
          return <line key={`x-${tick}`} className="timeline-curve-grid" x1={x} x2={x} y1={PAD_Y} y2={HEIGHT - PAD_Y} />;
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = PAD_Y + tick * GRAPH_H;
          return <line key={`y-${tick}`} className="timeline-curve-grid" x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} />;
        })}
        <path className="timeline-curve-path" d={path} />
        {keys.map((item) => {
          const point = pointFor(item.time, item.value);
          return (
            <circle
              key={item.id}
              className={item.id === selected?.id ? 'timeline-curve-key selected' : 'timeline-curve-key'}
              cx={point.x}
              cy={point.y}
              r={item.id === selected?.id ? 5.5 : 4.5}
              onDoubleClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedId(item.id);
                setDraggingId(item.id);
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              }}
            />
          );
        })}
        <text className="timeline-curve-axis" x={PAD_X} y={HEIGHT - 3}>0</text>
        <text className="timeline-curve-axis end" x={WIDTH - PAD_X} y={HEIGHT - 3}>1 · normalized time</text>
        <text className="timeline-curve-axis" x={3} y={PAD_Y + 4}>{displayNumber(range.max)}</text>
        <text className="timeline-curve-axis" x={3} y={HEIGHT - PAD_Y}>{displayNumber(range.min)}</text>
      </svg>

      {selected && (
        <div className="timeline-key-fields">
          <label>
            <span>Time</span>
            <input type="number" min="0" max="1" step="0.01" value={displayNumber(selected.time)} onChange={(event) => patchKey(selected.id, { time: Number(event.target.value) })} />
          </label>
          <label>
            <span>Value</span>
            <input type="number" step="0.05" value={displayNumber(selected.value)} onChange={(event) => patchKey(selected.id, { value: Number(event.target.value) })} />
          </label>
          <label>
            <span>Segment</span>
            <select value={selected.interpolation} onChange={(event) => patchKey(selected.id, { interpolation: event.target.value as TimelineCurveKey['interpolation'] })}>
              <option value="cubic">Cubic</option>
              <option value="linear">Linear</option>
              <option value="hold">Hold</option>
            </select>
          </label>
          {selected.interpolation === 'cubic' && (
            <>
              <label>
                <span>Arrive tangent</span>
                <input type="number" step="0.1" value={displayNumber(selected.inTangent ?? 0)} onChange={(event) => patchKey(selected.id, { inTangent: Number(event.target.value) })} />
              </label>
              <label>
                <span>Leave tangent</span>
                <input type="number" step="0.1" value={displayNumber(selected.outTangent ?? 0)} onChange={(event) => patchKey(selected.id, { outTangent: Number(event.target.value) })} />
              </label>
            </>
          )}
          <button
            type="button"
            className="timeline-delete-key"
            disabled={keys.length <= 2}
            onClick={() => {
              const index = keys.findIndex((item) => item.id === selected.id);
              const remaining = keys.filter((item) => item.id !== selected.id);
              setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? '');
              commit(remaining);
            }}
          >
            Delete key
          </button>
        </div>
      )}
      <p className="field-hint">Drag keys to shape motion. Double-click the graph to add a key. Values may overshoot below 0 or above 1.</p>
    </div>
  );
}
