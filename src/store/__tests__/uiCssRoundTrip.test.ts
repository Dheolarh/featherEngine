/**
 * A shared UI kit is only shareable if its look survives the trip. The look now lives in
 * `doc.css` + `element.css` rather than in style objects, so the package pipeline has to carry
 * both through collect → export → import (which regenerates every id).
 */
import { describe, expect, it } from 'vitest';
import { collectPackage, remapPackageForImport } from '../../project/package';
import type { NodeForgePackage, PackageSource } from '../../project/package';
import type { UIDocument } from '../../types';

const kit: UIDocument = {
  id: 'ui-1',
  name: 'Kit',
  surface: 'screen',
  visibleOnStart: true,
  createdAt: 0,
  folderId: 'f1',
  css: '.badge { color: gold }',
  root: {
    id: 'e1',
    kind: 'panel',
    name: 'root',
    style: {},
    bindings: [],
    children: [
      { id: 'e2', kind: 'text', name: 'badge', className: 'badge', css: 'padding: 7px', style: {}, bindings: [], children: [] },
    ],
  },
};

describe('UI CSS survives a package round-trip', () => {
  it('carries doc.css, element.css and className through export + import', () => {
    const src = {
      prefabs: [], blueprints: [], graphs: [], materials: [], particleSystems: [], skeletons: [],
      skeletalMeshes: [], animations: [], animatorControllers: [], dataAssets: [], variables: [],
      uiDocuments: [kit], folders: [{ id: 'f1', name: 'Kit' }], assets: [],
    } as unknown as PackageSource;
    const collected = collectPackage(src, { uiDocuments: ['ui-1'] });
    expect(collected.content.uiDocuments).toHaveLength(1);

    const pkg = { content: collected.content, assets: [] } as unknown as NodeForgePackage;
    const imported = remapPackageForImport(pkg).content.uiDocuments[0];

    expect(imported.css).toBe('.badge { color: gold }');
    expect(imported.root.children[0].css).toBe('padding: 7px');
    expect(imported.root.children[0].className).toBe('badge');
    // Ids are regenerated on import, so two copies of a kit can coexist.
    expect(imported.id).not.toBe('ui-1');
    expect(imported.root.children[0].id).not.toBe('e2');
  });
});
