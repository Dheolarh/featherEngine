import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls, TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  Box, Cone, Copy, Cylinder, Globe, Hammer, Move3d, PackagePlus, Paintbrush, Pyramid, RotateCcw, Trash2,
} from 'lucide-react';
import type { ModelPart, ModelPartShape, ModelSpec, ModelStyle, Vector3Tuple } from '../types';
import { DEFAULT_MODEL_STYLE, MODEL_FACE_GROUPS, MODEL_PART_SHAPES } from '../model/modelSpec';
import { buildModelGroup, faceGroupForFaceIndex, getPartRenderEdges, getPartRenderGeometry } from '../model/modelGeometry';
import { ModelPartMesh } from '../three/ModelMesh';
import { RangeField } from '../components/InspectorPanel';
import { defineFeatherPlugin, type FeatherPluginAPI } from './types';

/**
 * Model Forge — the store-installable prototype modeler: kit-bash primitives, paint faces from a
 * flat palette, place live-linked props, bake to GLB when a prop graduates.
 *
 * Like Arbor Forge, everything goes through the public plugin API (api.models / api.objects /
 * api.panels / api.ui) — the panel is exactly the shape an outside plugin author would ship. The
 * model DATA layer (specs, rendering, serialization, AI tools) lives in the engine, so placed props
 * keep rendering and the AI keeps working even while this plugin is not installed; the plugin is
 * the visual studio on top.
 */

const PLUGIN_ID = 'feather.model-forge';
const PANEL_ID = `${PLUGIN_ID}.studio`;

const SHAPE_ICONS: Record<ModelPartShape, typeof Box> = {
  box: Box,
  cylinder: Cylinder,
  sphere: Globe,
  cone: Cone,
  wedge: Pyramid,
};

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const round = (value: number, decimals = 4): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Matches the default editor accent; canvas shaders can't read CSS variables. */
const OUTLINE_ACCENT = '#5b8cff';

const ignoreOutlineRaycast = () => null;

/** Edge outline that hugs one part — bevel- and deformation-accurate hover/selection feedback. */
function PartOutline({ part, style, color, opacity, neutralTransform }: {
  part: ModelPart;
  style?: ModelStyle;
  color: string;
  opacity: number;
  neutralTransform?: boolean;
}) {
  return (
    <lineSegments
      geometry={getPartRenderEdges(part, style)}
      position={neutralTransform ? [0, 0, 0] : part.position}
      rotation={neutralTransform ? [0, 0, 0] : part.rotation}
      scale={neutralTransform ? [1, 1, 1] : part.scale}
      raycast={ignoreOutlineRaycast}
    >
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
}

const cornerBase = (index: number): THREE.Vector3 =>
  new THREE.Vector3(index & 1 ? 0.5 : -0.5, index & 2 ? 0.5 : -0.5, index & 4 ? 0.5 : -0.5);

/**
 * Mesh mode: the 8 draggable corner vertices of a box part, in WORLD space (nesting a gizmo under
 * the part's non-uniform scale would skew it). Commits translate back through the part's inverse
 * matrix into unit-space offsets — the same gizmo rules as parts: commit on release, guard the ref.
 */
function CornerHandles({ part, snap, roundTo, selectedCorner, onSelectCorner, onCommit, gizmoActive }: {
  part: ModelPart;
  snap: boolean;
  roundTo: (value: number, decimals?: number) => number;
  selectedCorner: number;
  onSelectCorner: (index: number) => void;
  onCommit: (corners: Record<number, Vector3Tuple> | null) => void;
  gizmoActive: { current: boolean };
}) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const { inverse, worldCorners } = useMemo(() => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...part.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
      new THREE.Vector3(...part.scale),
    );
    return {
      inverse: matrix.clone().invert(),
      worldCorners: Array.from({ length: 8 }, (_, index) => {
        const local = cornerBase(index);
        const offset = part.corners?.[index];
        if (offset) local.add(new THREE.Vector3(...offset));
        return local.applyMatrix4(matrix);
      }),
    };
  }, [part]);

  const commit = () => {
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target || selectedCorner < 0) return;
    const offset = target.position.clone().applyMatrix4(inverse).sub(cornerBase(selectedCorner));
    const rounded: Vector3Tuple = [roundTo(offset.x, 3), roundTo(offset.y, 3), roundTo(offset.z, 3)];
    const next: Record<number, Vector3Tuple> = { ...part.corners };
    if (Math.hypot(rounded[0], rounded[1], rounded[2]) < 0.01) delete next[selectedCorner];
    else next[selectedCorner] = rounded;
    onCommit(Object.keys(next).length ? next : null);
  };

  return (
    <>
      {worldCorners.map((world, index) =>
        index === selectedCorner ? (
          <TransformControls
            key={index}
            ref={controlsRef}
            mode="translate"
            size={0.65}
            translationSnap={snap ? 0.05 : null}
            position={[world.x, world.y, world.z]}
            onMouseDown={() => {
              gizmoActive.current = true;
            }}
            onMouseUp={() => {
              commit();
              setTimeout(() => {
                gizmoActive.current = false;
              }, 0);
            }}
          >
            <mesh>
              <sphereGeometry args={[0.055, 12, 10]} />
              <meshBasicMaterial color={OUTLINE_ACCENT} toneMapped={false} />
            </mesh>
          </TransformControls>
        ) : (
          <mesh
            key={index}
            position={[world.x, world.y, world.z]}
            onPointerDown={(event) => {
              if (event.nativeEvent.button !== 0) return;
              event.stopPropagation();
              onSelectCorner(index);
            }}
          >
            <sphereGeometry args={[0.045, 12, 10]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ),
      )}
    </>
  );
}

interface ForgePreviewProps {
  spec: ModelSpec;
  mode: 'build' | 'mesh' | 'paint';
  gizmoMode: 'translate' | 'rotate' | 'scale';
  snap: boolean;
  selectedPartId: string;
  onSelectPart: (partId: string) => void;
  onPaintFace: (partId: string, faceGroup: number) => void;
  onCommitPart: (partId: string, patch: Pick<ModelPart, 'position' | 'rotation' | 'scale'>) => void;
  onCommitCorners: (partId: string, corners: Record<number, Vector3Tuple> | null) => void;
}

function ForgePreview({ spec, mode, gizmoMode, snap, selectedPartId, onSelectPart, onPaintFace, onCommitPart, onCommitCorners }: ForgePreviewProps) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  // True from gizmo grab until just AFTER release: the gizmo raycasts through its own DOM
  // listeners, so r3f sees a handle grab as "missed everything" — without this guard the
  // background-click deselect fires on every gizmo interaction and unmounts the gizmo mid-use.
  const gizmoActive = useRef(false);
  // Where the pointer went down, so the deselect below can tell a click from an orbit drag.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  // Frame the initial camera off the model's bounds. The Canvas is keyed by spec id, so switching
  // models reframes while edits within one model never yank the camera around.
  const framing = useMemo(() => {
    const size = new THREE.Box3().setFromObject(buildModelGroup(spec)).getSize(new THREE.Vector3());
    const radius = Math.max(1.6, Math.max(size.y, (size.x + size.z) * 0.5) * 0.85);
    return { radius, height: Math.max(1.2, size.y) };
    // Only on mount (Canvas is remounted per spec id) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mesh mode: which of the selected box part's 8 corners carries the vertex gizmo.
  const [selectedCorner, setSelectedCorner] = useState(-1);
  useEffect(() => {
    setSelectedCorner(-1);
  }, [selectedPartId, mode]);

  // Hover feedback. Guarded during gizmo drags: a hover re-render makes drei re-attach its
  // controls, and detach() would end the active drag (same mechanism as the commit-on-release fix).
  const [hoveredPartId, setHoveredPartId] = useState('');
  const handlePartPointerOver = (part: ModelPart, event: ThreeEvent<PointerEvent>) => {
    if (gizmoActive.current) return;
    event.stopPropagation();
    setHoveredPartId(part.id);
  };
  const handlePartPointerOut = (part: ModelPart) => {
    if (gizmoActive.current) return;
    setHoveredPartId((current) => (current === part.id ? '' : current));
  };

  const handlePartPointerDown = (part: ModelPart, event: ThreeEvent<PointerEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    if (mode === 'paint') {
      const faceIndex = event.faceIndex;
      if (faceIndex != null) onPaintFace(part.id, faceGroupForFaceIndex(getPartRenderGeometry(part, spec.style), faceIndex));
      return;
    }
    onSelectPart(part.id);
  };

  // Commit ONCE on release, never per move-tick. A mid-drag commit re-renders the panel, drei
  // re-attaches its controls when children re-render, and detach() nulls the active axis — which
  // silently ends the drag after its first movement tick. During the drag the gizmo moves the
  // mesh imperatively, so the preview still tracks the pointer live.
  const commitFromGizmo = () => {
    // `object` is typed private on three-stdlib's TransformControls, but it IS the attached group.
    const target = (controlsRef.current as unknown as { object?: THREE.Object3D } | null)?.object;
    if (!target || !selectedPartId) return;
    onCommitPart(selectedPartId, {
      position: [round(target.position.x), round(target.position.y), round(target.position.z)],
      rotation: [round(target.rotation.x), round(target.rotation.y), round(target.rotation.z)],
      scale: [round(Math.max(0.01, target.scale.x)), round(Math.max(0.01, target.scale.y)), round(Math.max(0.01, target.scale.z))],
    });
  };

  const handleGizmoDown = () => {
    gizmoActive.current = true;
  };
  const handleGizmoUp = () => {
    commitFromGizmo();
    // The DOM click that ends the interaction fires after pointerup — keep the guard through it.
    setTimeout(() => {
      gizmoActive.current = false;
    }, 0);
  };

  return (
    <Canvas
      shadows
      camera={{ position: [framing.radius * 1.7, framing.height * 0.9 + 0.6, framing.radius * 1.7], fov: 45 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#1a1f27');
      }}
      onPointerDown={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMissed={(event) => {
        if (mode === 'paint' || gizmoActive.current) return;
        // Orbiting also ends in a "missed" click — only a true stationary click deselects.
        const down = pointerDownAt.current;
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
        setSelectedCorner(-1);
        onSelectPart('');
      }}
      style={{ cursor: mode === 'paint' ? 'crosshair' : hoveredPartId ? 'pointer' : 'default' }}
    >
      <hemisphereLight args={['#cfe6ff', '#3d4438', 0.9]} />
      <directionalLight position={[6, 12, 5]} intensity={2.0} castShadow />
      {/* Spline-style ground: a distance-faded grid plus a soft blurred contact shadow. */}
      <Grid
        position={[0, -0.002, 0]}
        args={[12, 12]}
        cellSize={0.25}
        cellThickness={0.6}
        cellColor="#232a36"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#30394d"
        fadeDistance={26}
        fadeStrength={1.2}
        infiniteGrid
      />
      <ContactShadows position={[0, 0.004, 0]} opacity={0.42} scale={16} blur={2.6} far={7} resolution={256} />
      {spec.parts.map((part) =>
        mode === 'build' && part.id === selectedPartId ? (
          <TransformControls
            key={part.id}
            ref={controlsRef}
            mode={gizmoMode}
            translationSnap={snap ? 0.25 : null}
            rotationSnap={snap ? Math.PI / 12 : null}
            scaleSnap={snap ? 0.1 : null}
            position={part.position}
            rotation={part.rotation}
            scale={part.scale}
            onMouseDown={handleGizmoDown}
            onMouseUp={handleGizmoUp}
          >
            {/* drei types children as ONE element; the identity group also keeps controls attachment stable. */}
            <group>
              <ModelPartMesh
                part={part}
                palette={spec.palette}
                style={spec.style}
                neutralTransform
                onPartPointerDown={handlePartPointerDown}
                onPartPointerOver={handlePartPointerOver}
                onPartPointerOut={handlePartPointerOut}
              />
              <PartOutline part={part} style={spec.style} color={OUTLINE_ACCENT} opacity={0.9} neutralTransform />
            </group>
          </TransformControls>
        ) : (
          <ModelPartMesh
            key={part.id}
            part={part}
            palette={spec.palette}
            style={spec.style}
            onPartPointerDown={handlePartPointerDown}
            onPartPointerOver={handlePartPointerOver}
            onPartPointerOut={handlePartPointerOut}
          />
        ),
      )}
      {mode !== 'build' && selectedPartId && (() => {
        const selected = spec.parts.find((part) => part.id === selectedPartId);
        return selected ? <PartOutline part={selected} style={spec.style} color={OUTLINE_ACCENT} opacity={0.55} /> : null;
      })()}
      {mode === 'mesh' && (() => {
        const selected = spec.parts.find((part) => part.id === selectedPartId);
        if (!selected || selected.shape !== 'box') return null;
        return (
          <CornerHandles
            part={selected}
            snap={snap}
            roundTo={round}
            selectedCorner={selectedCorner}
            onSelectCorner={setSelectedCorner}
            onCommit={(corners) => onCommitCorners(selected.id, corners)}
            gizmoActive={gizmoActive}
          />
        );
      })()}
      {hoveredPartId && hoveredPartId !== selectedPartId && (() => {
        const hovered = spec.parts.find((part) => part.id === hoveredPartId);
        return hovered ? <PartOutline part={hovered} style={spec.style} color="#ffffff" opacity={0.3} /> : null;
      })()}
      {/* makeDefault lets the gizmo auto-pause orbiting while a handle is dragged; damping = the glide. */}
      <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.08} target={[0, framing.height * 0.45, 0]} />
    </Canvas>
  );
}

function VecField({ label, value, step = 0.1, toDisplay = (v: number) => v, fromDisplay = (v: number) => v, onChange }: {
  label: string;
  value: Vector3Tuple;
  step?: number;
  toDisplay?: (value: number) => number;
  fromDisplay?: (value: number) => number;
  onChange: (next: Vector3Tuple) => void;
}) {
  return (
    <label className="node-field model-vec-field">
      <span>{label}</span>
      <div className="model-vec-inputs">
        {([0, 1, 2] as const).map((axis) => (
          <input
            key={axis}
            type="number"
            step={step}
            value={round(toDisplay(value[axis]), 3)}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              const next = [...value] as Vector3Tuple;
              next[axis] = fromDisplay(parsed);
              onChange(next);
            }}
          />
        ))}
      </div>
    </label>
  );
}

function PaletteStrip({ palette, activeSlot, onPick }: { palette: readonly string[]; activeSlot: number; onPick: (slot: number) => void }) {
  return (
    <div className="model-palette-strip" role="listbox" aria-label="Palette">
      {palette.map((color, slot) => (
        <button
          key={slot}
          className={`model-swatch${slot === activeSlot ? ' active' : ''}`}
          style={{ background: color }}
          title={`Slot ${slot} · ${color}`}
          onClick={() => onPick(slot)}
        />
      ))}
    </div>
  );
}

function ModelForgePanel({ api }: { api: FeatherPluginAPI }) {
  // The plugin sees the library through detached api snapshots; models:changed says when to
  // re-read (edits from this panel, the AI tools, and undo all funnel through the same event).
  const [library, setLibrary] = useState<ReadonlyArray<Readonly<ModelSpec>>>(() => api.models.library());
  const [placedRefresh, setPlacedRefresh] = useState(0);
  useEffect(() => api.events.on('models:changed', () => setLibrary(api.models.library())), [api]);
  useEffect(() => api.events.on('scene:changed', () => setPlacedRefresh((tick) => tick + 1)), [api]);

  const [selectedSpecId, setSelectedSpecId] = useState('');
  const [mode, setMode] = useState<'build' | 'mesh' | 'paint'>('build');
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [snap, setSnap] = useState(true);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [activeSlot, setActiveSlot] = useState(1);
  const [baking, setBaking] = useState(false);
  const [status, setStatus] = useState('Build with primitives, then switch to Paint and click faces.');

  const spec = library.find((entry) => entry.id === selectedSpecId) ?? library[0];
  const placedCount = useMemo(
    () => (spec ? api.objects.list().filter((object) => object.model?.specId === spec.id).length : 0),
    // placedRefresh re-counts after scene changes (placing, deleting, undo).
    [api, spec, placedRefresh],
  );

  /** Every mutation funnels through here so a Play-mode or no-project error reads in the panel, not the console. */
  const attempt = (label: string, action: () => string) => {
    try {
      setStatus(action());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      api.ui.notify(`${label}: ${message}`, 'error');
    }
  };

  if (!spec) {
    return (
      <section className="panel material-panel">
        <div className="empty-state wide">
          <Box size={18} aria-hidden />
          <span>No model assets yet</span>
          <button
            className="full-button"
            onClick={() => attempt('Create model', () => {
              setSelectedSpecId(api.models.createFromStarter('crate'));
              return 'Created a Wooden Crate to start from.';
            })}
          >
            Create Model
          </button>
        </div>
      </section>
    );
  }

  const selectedPart = spec.parts.find((part) => part.id === selectedPartId);
  const clampedActiveSlot = Math.min(activeSlot, spec.palette.length - 1);
  const shapeFaceGroups = selectedPart ? MODEL_FACE_GROUPS[selectedPart.shape] : {};

  const addPart = (shape: ModelPartShape) =>
    attempt('Add part', () => {
      const partId = api.models.addPart(spec.id, shape, { colorSlot: clampedActiveSlot });
      setSelectedPartId(partId);
      setMode('build');
      return `Added a ${shape}.`;
    });

  const placeInScene = () =>
    attempt('Place model', () => {
      const objectId = api.models.place(spec.id);
      api.objects.select(objectId);
      return `Placed "${spec.name}" in the scene — it stays linked, so edits here restyle it live.`;
    });

  const bakeToAsset = async () => {
    setBaking(true);
    try {
      const { fileName } = await api.models.bakeToAsset(spec.id);
      const message = `Baked "${spec.name}" to ${fileName} — it is in the Assets panel now.`;
      setStatus(message);
      api.ui.notify(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Bake failed: ${message}`);
      api.ui.notify(`Bake failed: ${message}`, 'error');
    } finally {
      setBaking(false);
    }
  };

  const styleOf = (entry: ModelSpec): ModelStyle => entry.style ?? DEFAULT_MODEL_STYLE;
  const patchStyle = (patch: Partial<ModelStyle>) =>
    attempt('Restyle model', () => {
      api.models.updateSpec(spec.id, { style: { ...styleOf(spec), ...patch } });
      return patch.finish
        ? patch.finish === 'smooth'
          ? 'Smooth finish: rounded corners + satin shading, Spline-style.'
          : 'Flat finish: crisp faceted edges, Meshy-style.'
        : status;
    });

  const paintFace = (partId: string, faceGroup: number) =>
    attempt('Paint face', () => {
      api.models.paintPart(spec.id, partId, clampedActiveSlot, faceGroup);
      setSelectedPartId(partId);
      return `Painted ${MODEL_FACE_GROUPS[spec.parts.find((part) => part.id === partId)?.shape ?? 'box'][faceGroup] ?? 'face'} with slot ${clampedActiveSlot}.`;
    });

  const editPaletteColor = (slot: number, color: string) =>
    attempt('Edit palette', () => {
      const palette = [...spec.palette];
      palette[slot] = color;
      api.models.setPalette(spec.id, palette);
      return status;
    });

  return (
    <section className="panel material-panel terrain-panel model-forge-panel">
      <div className="terrain-editor-body tree-builder-body">
        <aside className="node-palette terrain-toolbox">
          <div className="terrain-layer-list">
            {library.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === spec.id ? 'active' : ''}
                onClick={() => {
                  setSelectedSpecId(entry.id);
                  setSelectedPartId('');
                }}
                title={`${entry.name} · ${entry.parts.length} parts`}
              >
                <Box size={13} aria-hidden />
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
          <button
            className="full-button"
            onClick={() => attempt('Duplicate model', () => {
              setSelectedSpecId(api.models.duplicateSpec(spec.id));
              return `Duplicated "${spec.name}".`;
            })}
          >
            <Copy size={13} aria-hidden /> Duplicate
          </button>
          <button
            className="full-button danger-soft"
            onClick={() => attempt('Delete model', () => {
              api.models.deleteSpec(spec.id);
              setSelectedPartId('');
              return `Deleted "${spec.name}" — placed copies keep their geometry.`;
            })}
          >
            <Trash2 size={13} aria-hidden /> Delete
          </button>
          <button className="full-button primary" onClick={placeInScene}>Place in Scene</button>
          <button className="full-button" onClick={bakeToAsset} disabled={baking}>
            <PackagePlus size={13} aria-hidden /> {baking ? 'Baking…' : 'Bake to GLB Asset'}
          </button>
          <h4 className="inspector-subhead">New model</h4>
          <div className="model-starter-grid">
            {api.models.starters().map((starter) => (
              <button
                key={starter.id}
                title={starter.tagline}
                onClick={() => attempt('Create model', () => {
                  setSelectedSpecId(api.models.createFromStarter(starter.id));
                  setSelectedPartId('');
                  return `Created a ${starter.name}.`;
                })}
              >
                {starter.name}
              </button>
            ))}
          </div>
        </aside>

        <div className="terrain-preview-column">
          <div className="tree-preview-canvas model-forge-canvas">
            <ForgePreview
              key={spec.id}
              spec={spec}
              mode={mode}
              gizmoMode={gizmoMode}
              snap={snap}
              selectedPartId={selectedPartId}
              onSelectPart={setSelectedPartId}
              onPaintFace={paintFace}
              onCommitPart={(partId, patch) => attempt('Move part', () => {
                api.models.updatePart(spec.id, partId, patch);
                return status;
              })}
              onCommitCorners={(partId, corners) => attempt('Edit vertices', () => {
                api.models.setPartCorners(spec.id, partId, corners);
                return corners ? 'Vertex committed — the whole hull deforms through the 8 corners.' : 'Vertices reset.';
              })}
            />
          </div>
          <div className="tree-preview-meta">
            <span>{spec.name} · {spec.parts.length} parts</span>
            <span>{placedCount} placed</span>
          </div>
          <div className="model-toolbar">
            <div className="model-toolbar-seg" role="tablist" aria-label="Mode">
              <button className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')}>
                <Hammer size={12} aria-hidden /> Build
              </button>
              <button className={mode === 'mesh' ? 'active' : ''} onClick={() => setMode('mesh')}>
                <Move3d size={12} aria-hidden /> Mesh
              </button>
              <button className={mode === 'paint' ? 'active' : ''} onClick={() => setMode('paint')}>
                <Paintbrush size={12} aria-hidden /> Paint
              </button>
            </div>
            {mode === 'build' && (
              <div className="model-toolbar-seg" role="tablist" aria-label="Gizmo">
                <button className={gizmoMode === 'translate' ? 'active' : ''} onClick={() => setGizmoMode('translate')}>Move</button>
                <button className={gizmoMode === 'rotate' ? 'active' : ''} onClick={() => setGizmoMode('rotate')}>Rotate</button>
                <button className={gizmoMode === 'scale' ? 'active' : ''} onClick={() => setGizmoMode('scale')}>Scale</button>
              </div>
            )}
            <label className="model-snap-toggle">
              <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap
            </label>
          </div>
          <p className="field-hint">
            {mode === 'paint'
              ? 'Click a face in the preview to paint it with the selected palette color.'
              : mode === 'mesh'
                ? 'Click a box part, then drag its corner vertices to sculpt the hull (bevel included). Other shapes edit via Build.'
                : 'Click a part to select it, then drag the gizmo. Placed copies update live as you edit.'}
          </p>
          <p className="field-hint">{status}</p>
        </div>

        <aside className="graph-inspector terrain-controls">
          <div className="node-inspector-body">
            <div className="terrain-control-grid">
              <label className="node-field">
                <span>Name</span>
                <input
                  value={spec.name}
                  onChange={(event) => attempt('Rename model', () => {
                    api.models.updateSpec(spec.id, { name: event.target.value });
                    return status;
                  })}
                />
              </label>

              <h4 className="inspector-subhead">Palette</h4>
              <PaletteStrip palette={spec.palette} activeSlot={clampedActiveSlot} onPick={setActiveSlot} />
              <div className="model-palette-edit">
                <input
                  type="color"
                  value={spec.palette[clampedActiveSlot] ?? '#888888'}
                  onChange={(event) => editPaletteColor(clampedActiveSlot, event.target.value)}
                  title="Edit selected color"
                />
                <button
                  className="full-button"
                  disabled={spec.palette.length >= 16}
                  onClick={() => attempt('Add color', () => {
                    api.models.setPalette(spec.id, [...spec.palette, spec.palette[clampedActiveSlot] ?? '#888888']);
                    return status;
                  })}
                >
                  Add color
                </button>
              </div>

              <h4 className="inspector-subhead">Style</h4>
              <div className="model-toolbar-seg" role="tablist" aria-label="Finish">
                <button
                  className={styleOf(spec).finish === 'smooth' ? 'active' : ''}
                  title="Spline-soft: rounded corners, smooth shading, satin sheen"
                  onClick={() => patchStyle({ finish: 'smooth' })}
                >
                  Smooth
                </button>
                <button
                  className={styleOf(spec).finish === 'flat' ? 'active' : ''}
                  title="Meshy-crisp: hard edges, faceted flat shading"
                  onClick={() => patchStyle({ finish: 'flat' })}
                >
                  Flat
                </button>
              </div>
              {styleOf(spec).finish === 'smooth' && (
                <RangeField
                  label="Bevel"
                  value={styleOf(spec).bevel}
                  min={0}
                  max={0.2}
                  step={0.005}
                  onChange={(value) => patchStyle({ bevel: value })}
                />
              )}
              <RangeField
                label="Roughness"
                value={styleOf(spec).roughness}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(value) => patchStyle({ roughness: value })}
              />

              <h4 className="inspector-subhead">Add part</h4>
              <div className="model-shape-row">
                {MODEL_PART_SHAPES.map((shape) => {
                  const Icon = SHAPE_ICONS[shape];
                  return (
                    <button key={shape} title={`Add ${shape}`} onClick={() => addPart(shape)}>
                      <Icon size={14} aria-hidden />
                    </button>
                  );
                })}
              </div>

              {selectedPart ? (
                <>
                  <h4 className="inspector-subhead">Part · {selectedPart.name}</h4>
                  <label className="node-field">
                    <span>Name</span>
                    <input
                      value={selectedPart.name}
                      onChange={(event) => attempt('Rename part', () => {
                        api.models.updatePart(spec.id, selectedPart.id, { name: event.target.value });
                        return status;
                      })}
                    />
                  </label>
                  <label className="node-field">
                    <span>Shape</span>
                    <select
                      value={selectedPart.shape}
                      onChange={(event) => attempt('Reshape part', () => {
                        api.models.updatePart(spec.id, selectedPart.id, { shape: event.target.value as ModelPartShape });
                        return status;
                      })}
                    >
                      {MODEL_PART_SHAPES.map((shape) => (
                        <option key={shape} value={shape}>{shape}</option>
                      ))}
                    </select>
                  </label>
                  <VecField
                    label="Position"
                    value={selectedPart.position}
                    step={0.25}
                    onChange={(next) => attempt('Move part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { position: next });
                      return status;
                    })}
                  />
                  <VecField
                    label="Rotation°"
                    value={selectedPart.rotation}
                    step={15}
                    toDisplay={(v) => v * RAD2DEG}
                    fromDisplay={(v) => v * DEG2RAD}
                    onChange={(next) => attempt('Rotate part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { rotation: next });
                      return status;
                    })}
                  />
                  <VecField
                    label="Size"
                    value={selectedPart.scale}
                    step={0.25}
                    onChange={(next) => attempt('Resize part', () => {
                      api.models.updatePart(spec.id, selectedPart.id, { scale: next.map((v) => Math.max(0.01, v)) as Vector3Tuple });
                      return status;
                    })}
                  />
                  <label className="node-field">
                    <span>Color</span>
                    <PaletteStrip
                      palette={spec.palette}
                      activeSlot={selectedPart.colorSlot}
                      onPick={(slot) => attempt('Paint part', () => {
                        api.models.paintPart(spec.id, selectedPart.id, slot);
                        return `Painted "${selectedPart.name}" with slot ${slot}.`;
                      })}
                    />
                  </label>
                  {Object.keys(shapeFaceGroups).length > 1 && (
                    <div className="model-face-chips">
                      {Object.entries(shapeFaceGroups).map(([group, label]) => {
                        const groupIndex = Number(group);
                        const effectiveSlot = selectedPart.faceColors?.[groupIndex] ?? selectedPart.colorSlot;
                        return (
                          <button
                            key={group}
                            title={`Paint ${label} with the selected palette color`}
                            onClick={() => paintFace(selectedPart.id, groupIndex)}
                          >
                            <span className="model-face-chip-swatch" style={{ background: spec.palette[effectiveSlot] ?? '#888' }} aria-hidden />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selectedPart.corners && (
                    <button
                      className="full-button"
                      onClick={() => attempt('Reset vertices', () => {
                        api.models.setPartCorners(spec.id, selectedPart.id, null);
                        return `Reset "${selectedPart.name}" back to a pristine box.`;
                      })}
                    >
                      <RotateCcw size={13} aria-hidden /> Reset Vertices
                    </button>
                  )}
                  <div className="model-part-actions">
                    <button
                      className="full-button"
                      onClick={() => attempt('Duplicate part', () => {
                        setSelectedPartId(api.models.duplicatePart(spec.id, selectedPart.id));
                        return `Duplicated "${selectedPart.name}".`;
                      })}
                    >
                      <Copy size={13} aria-hidden /> Duplicate Part
                    </button>
                    <button
                      className="full-button danger-soft"
                      onClick={() => attempt('Delete part', () => {
                        api.models.removePart(spec.id, selectedPart.id);
                        setSelectedPartId('');
                        return `Deleted "${selectedPart.name}".`;
                      })}
                    >
                      <Trash2 size={13} aria-hidden /> Delete Part
                    </button>
                  </div>
                </>
              ) : (
                <p className="field-hint">
                  {mode === 'paint'
                    ? 'Painting the whole model: click faces in the preview.'
                    : 'No part selected — click one in the preview, or add a primitive above.'}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export const modelForgePlugin = defineFeatherPlugin({
  id: PLUGIN_ID,
  name: 'Model Forge',
  version: '1.0.0',
  description:
    'In-engine prototype modeler: kit-bash five primitives into props, paint faces from a flat stylized palette, place live-linked copies, and bake finished props into real GLB model assets.',
  apiVersion: '0.2.0',
  activate(api) {
    api.panels.register({
      id: PANEL_ID,
      title: 'Model Forge',
      // A library + 3D gizmo canvas + part inspector needs Tree-Builder width, so it docks below the viewport.
      placement: { referencePanel: 'viewport', direction: 'below' },
      render: () => <ModelForgePanel api={api} />,
    });

    api.commands.register({
      id: `${PLUGIN_ID}.open`,
      title: 'Open Model Forge (prototype modeler)',
      group: 'Extensions',
      keywords: 'model prop prototype blockout kitbash paint fence crate mesh',
      run: () => {
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.commands.register({
      id: `${PLUGIN_ID}.new-prop`,
      title: 'New prototype prop (Model Forge)',
      group: 'Extensions',
      keywords: 'model prop new crate starter',
      run: () => {
        api.models.createFromStarter('crate');
        if (!api.panels.open(PANEL_ID)) api.ui.notify('The editor workspace is not ready yet.', 'error');
      },
    });

    api.log.info('Activated');
    return () => api.log.info('Deactivated');
  },
});
