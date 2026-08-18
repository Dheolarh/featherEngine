import type { ScriptBlueprint } from '../types';

export const FEATHER_SOURCE_DIRECTORY = 'scripts';
export const FEATHER_SOURCE_EXTENSION = '.feather';

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

/**
 * Makes editor-only differences predictable before sources are compared or fingerprinted.
 * FeatherScript indentation remains untouched; only a BOM, line endings, and redundant final
 * newlines are canonicalized.
 */
export const normalizeFeatherSource = (source: string): string => {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return normalized ? `${normalized}\n` : '';
};

const hashText = (value: string): string => {
  let hash = FNV_64_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
};

/** A versioned, deterministic content fingerprint. It is for change detection, not authentication. */
export const hashFeatherSource = (source: string): string =>
  `feather-fnv1a64-v1:${hashText(normalizeFeatherSource(source))}`;

const slugifyBlueprintName = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'blueprint';
};

/**
 * Creates a portable project-relative path. The suffix fingerprints the complete blueprint id, so
 * same-named blueprints and ids with a common prefix do not silently target the same file.
 */
export const makeFeatherSourcePath = (blueprintName: string, blueprintId: string): string => {
  const slug = slugifyBlueprintName(blueprintName);
  const shortId = hashText(blueprintId.normalize('NFC')).slice(-12);
  return `${FEATHER_SOURCE_DIRECTORY}/${slug}--${shortId}${FEATHER_SOURCE_EXTENSION}`;
};

export type FeatherSourceSyncKind = 'unchanged' | 'external-update' | 'internal-update' | 'conflict';

export interface FeatherSourceSyncInput {
  blueprint: Pick<
    ScriptBlueprint,
    | 'featherSource'
    | 'featherSourceLastSynced'
    | 'featherSourceLastSyncedHash'
    | 'featherSourceLastSyncedVisualHash'
  >;
  /** Source currently read from the linked file. */
  diskSource: string;
  /** Current visual graph rendered as FeatherScript. */
  visualSource: string;
}

export interface FeatherSourceSyncStatus {
  kind: FeatherSourceSyncKind;
  /** False only for a newly encountered file with no safe common ancestor. */
  baselineKnown: boolean;
  baselineHash?: string;
  diskHash: string;
  draftHash?: string;
  visualHash: string;
  diskChanged: boolean;
  /** The editable draft differs from the source last compiled into the graph. */
  draftChanged: boolean;
  /** The graph's logical source differs from the last confirmed external baseline. */
  visualChanged: boolean;
  /** Either the editable draft or visual graph has work not present at the external baseline. */
  internalChanged: boolean;
  /** Both internal representations changed to different content and require an explicit choice. */
  internalDiverged: boolean;
}

/**
 * Performs a conservative three-way classification. It never chooses disk, draft, or graph content
 * when more than one side changed. Callers can auto-apply only `external-update` and auto-write only
 * `internal-update`; every `conflict` needs an explicit user decision.
 */
export const classifyFeatherSourceSync = ({
  blueprint,
  diskSource,
  visualSource,
}: FeatherSourceSyncInput): FeatherSourceSyncStatus => {
  const diskHash = hashFeatherSource(diskSource);
  const draftHash =
    blueprint.featherSource === undefined ? undefined : hashFeatherSource(blueprint.featherSource);
  const compiledHash =
    blueprint.featherSourceLastSynced === undefined
      ? undefined
      : hashFeatherSource(blueprint.featherSourceLastSynced);
  const visualHash = hashFeatherSource(visualSource);
  // Only a confirmed external checkpoint is a safe common ancestor. `featherSourceLastSynced`
  // describes the graph compiler, not the file on disk; treating it as a disk baseline would make
  // a newly relinked, differing file look like an external-only update and bypass the conflict UI.
  const baselineHash = blueprint.featherSourceLastSyncedHash;

  if (baselineHash === undefined) {
    const internalRepresentationsAgree = draftHash === undefined || draftHash === visualHash;
    const allSidesAgree = internalRepresentationsAgree && diskHash === (draftHash ?? visualHash);
    return {
      kind: allSidesAgree ? 'unchanged' : 'conflict',
      baselineKnown: false,
      baselineHash: undefined,
      diskHash,
      draftHash,
      visualHash,
      diskChanged: !allSidesAgree,
      draftChanged: draftHash !== undefined && draftHash !== visualHash,
      visualChanged: !allSidesAgree,
      internalChanged: !allSidesAgree,
      internalDiverged: !internalRepresentationsAgree,
    };
  }

  const diskChanged = diskHash !== baselineHash;
  const draftChanged =
    draftHash !== undefined && draftHash !== (compiledHash ?? baselineHash);
  // New linked projects checkpoint the actual graph printer independently from authored text. This
  // keeps an invalid external draft (which intentionally cannot update the graph) from looking like
  // a visual edit on its next save. Older projects fall back to the last compiled authored source.
  const visualCheckpointHash = blueprint.featherSourceLastSyncedVisualHash;
  const logicalVisualHash = visualCheckpointHash === undefined ? compiledHash ?? visualHash : visualHash;
  const visualChanged = visualCheckpointHash === undefined
    ? logicalVisualHash !== baselineHash
    : visualHash !== visualCheckpointHash;
  const draftChangedFromBaseline = draftHash !== undefined && draftHash !== baselineHash;
  const internalChanged = draftChangedFromBaseline || visualChanged;
  const draftMatchesCompiled = draftHash !== undefined && draftHash === compiledHash;
  const internalDiverged =
    draftHash !== undefined && visualChanged && !draftMatchesCompiled && draftHash !== logicalVisualHash;
  const visibleInternalHash = draftHash ?? visualHash;
  const sidesConverged = diskChanged && internalChanged && diskHash === visibleInternalHash;

  let kind: FeatherSourceSyncKind;
  if (internalDiverged || (diskChanged && internalChanged && !sidesConverged)) kind = 'conflict';
  else if (diskChanged) kind = 'external-update';
  else if (internalChanged) kind = 'internal-update';
  else kind = 'unchanged';

  return {
    kind,
    baselineKnown: true,
    baselineHash,
    diskHash,
    draftHash,
    visualHash,
    diskChanged,
    draftChanged,
    visualChanged,
    internalChanged,
    internalDiverged,
  };
};
