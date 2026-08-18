import { describe, expect, it } from 'vitest';
import {
  classifyFeatherSourceSync,
  hashFeatherSource,
  makeFeatherSourcePath,
  normalizeFeatherSource,
} from '../featherExternalSource';

const baseline = ['blueprint Player', '', 'on start:', '    self.jump()'].join('\n');
const externalEdit = `${baseline}\n    print("External")`;
const internalEdit = `${baseline}\n    print("Internal")`;

const linkedBlueprint = (overrides: {
  featherSource?: string;
  featherSourceLastSynced?: string;
  featherSourceLastSyncedHash?: string;
  featherSourceLastSyncedVisualHash?: string;
} = {}) => ({
  featherSource: baseline,
  featherSourceLastSynced: baseline,
  featherSourceLastSyncedHash: hashFeatherSource(baseline),
  featherSourceLastSyncedVisualHash: hashFeatherSource(baseline),
  ...overrides,
});

describe('external FeatherScript source helpers', () => {
  it('normalizes BOMs, editor line endings, and final newlines without changing indentation', () => {
    expect(normalizeFeatherSource('\uFEFFblueprint Player\r\n\r    self.jump()\r\n\r\n')).toBe(
      'blueprint Player\n\n    self.jump()\n',
    );
    expect(normalizeFeatherSource('')).toBe('');
  });

  it('fingerprints normalized source deterministically', () => {
    const unix = 'blueprint Player\n\n';
    const windows = '\uFEFFblueprint Player\r\n';

    expect(hashFeatherSource(unix)).toBe(hashFeatherSource(windows));
    expect(hashFeatherSource(unix)).toMatch(/^feather-fnv1a64-v1:[0-9a-f]{16}$/);
    expect(hashFeatherSource('blueprint Enemy')).not.toBe(hashFeatherSource(unix));
  });

  it('makes portable, readable paths with an id-derived collision-resistant suffix', () => {
    const first = makeFeatherSourcePath("Café Player's Controller!", 'bp-common-prefix-111111');
    const second = makeFeatherSourcePath("Café Player's Controller!", 'bp-common-prefix-222222');

    expect(first).toMatch(/^scripts\/cafe-players-controller--[0-9a-f]{12}\.feather$/);
    expect(second).toMatch(/^scripts\/cafe-players-controller--[0-9a-f]{12}\.feather$/);
    expect(first).not.toBe(second);
    expect(makeFeatherSourcePath('🪶', 'bp-empty-name')).toMatch(
      /^scripts\/blueprint--[0-9a-f]{12}\.feather$/,
    );
  });
});

describe('classifyFeatherSourceSync', () => {
  it('reports unchanged for equivalent disk and synchronized internal content', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint(),
      diskSource: `${baseline}\r\n`,
      visualSource: `${baseline}\n`,
    });

    expect(status).toMatchObject({
      kind: 'unchanged',
      baselineKnown: true,
      diskChanged: false,
      draftChanged: false,
      visualChanged: false,
      internalChanged: false,
      internalDiverged: false,
    });
  });

  it('does not mistake the last compiled source for a confirmed external checkpoint', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSourceLastSyncedHash: undefined,
        featherSourceLastSyncedVisualHash: undefined,
      }),
      diskSource: externalEdit,
      visualSource: baseline,
    });

    expect(status).toMatchObject({ kind: 'conflict', baselineKnown: false });
  });

  it('reports an external update only when internal state is still at the baseline', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint(),
      diskSource: externalEdit,
      visualSource: baseline,
    });

    expect(status).toMatchObject({
      kind: 'external-update',
      diskChanged: true,
      internalChanged: false,
    });
  });

  it('reports an unsynced editable draft as an internal update without overwriting it', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({ featherSource: internalEdit }),
      diskSource: baseline,
      visualSource: baseline,
    });

    expect(status).toMatchObject({
      kind: 'internal-update',
      diskChanged: false,
      draftChanged: true,
      visualChanged: false,
      internalChanged: true,
    });
  });

  it('reports a visual graph update after the editable source checkpoint was invalidated', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSource: undefined,
        featherSourceLastSynced: undefined,
      }),
      diskSource: baseline,
      visualSource: internalEdit,
    });

    expect(status).toMatchObject({
      kind: 'internal-update',
      draftChanged: false,
      visualChanged: true,
      internalChanged: true,
    });
  });

  it('requires an explicit choice when disk and an unsynced draft both changed', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({ featherSource: internalEdit }),
      diskSource: externalEdit,
      visualSource: baseline,
    });

    expect(status).toMatchObject({
      kind: 'conflict',
      diskChanged: true,
      draftChanged: true,
      internalChanged: true,
    });
  });

  it('accepts the same edit made on disk and inside Feather without a false conflict', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({ featherSource: internalEdit }),
      diskSource: internalEdit,
      visualSource: baseline,
    });

    expect(status).toMatchObject({
      kind: 'external-update',
      diskChanged: true,
      internalChanged: true,
      internalDiverged: false,
    });
  });

  it('allows iterative external saves while an invalid draft keeps the previous graph alive', () => {
    const firstInvalid = `${baseline}\n    definitely_not_supported(`;
    const secondInvalid = `${baseline}\n    still_not_supported(`;
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSource: firstInvalid,
        featherSourceLastSynced: baseline,
        featherSourceLastSyncedHash: hashFeatherSource(firstInvalid),
        featherSourceLastSyncedVisualHash: hashFeatherSource(baseline),
      }),
      diskSource: secondInvalid,
      visualSource: baseline,
    });

    expect(status).toMatchObject({
      kind: 'external-update',
      diskChanged: true,
      visualChanged: false,
      internalDiverged: false,
    });
  });

  it('treats an authored draft and graph compiled from that draft as one internal update', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSource: internalEdit,
        featherSourceLastSynced: internalEdit,
      }),
      diskSource: baseline,
      visualSource: `${internalEdit}\n# printer formatting may differ`,
    });

    expect(status).toMatchObject({
      kind: 'internal-update',
      internalChanged: true,
      internalDiverged: false,
    });
  });

  it('requires an explicit choice when disk and the visual graph both changed', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSource: undefined,
        featherSourceLastSynced: undefined,
      }),
      diskSource: externalEdit,
      visualSource: internalEdit,
    });

    expect(status).toMatchObject({
      kind: 'conflict',
      diskChanged: true,
      visualChanged: true,
      internalChanged: true,
    });
  });

  it('requires an explicit choice when an internal draft and graph changed differently', () => {
    const status = classifyFeatherSourceSync({
      blueprint: linkedBlueprint({
        featherSource: internalEdit,
        featherSourceLastSynced: externalEdit,
      }),
      diskSource: baseline,
      visualSource: externalEdit,
    });

    expect(status).toMatchObject({
      kind: 'conflict',
      internalChanged: true,
      internalDiverged: true,
    });
  });

  it('does not guess a winner for an uncheckpointed link', () => {
    const equal = classifyFeatherSourceSync({
      blueprint: {},
      diskSource: baseline,
      visualSource: baseline,
    });
    const different = classifyFeatherSourceSync({
      blueprint: {},
      diskSource: externalEdit,
      visualSource: baseline,
    });

    expect(equal).toMatchObject({ kind: 'unchanged', baselineKnown: false });
    expect(different).toMatchObject({ kind: 'conflict', baselineKnown: false });
  });
});
