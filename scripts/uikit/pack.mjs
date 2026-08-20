/**
 * Wrap captured UIDocument(s) into an installable Feather package (.nfpack).
 *
 *   node scripts/uikit/pack.mjs --in hud.json [--in menu.json] --name "RPG UI Kit" --out rpg-ui.nfpack
 *
 * Emits the JSON form of a package, which readPackageFile() accepts alongside the ZIP form. Import
 * it from the editor (Project browser → Import Package) and it lands additively with every id
 * remapped, so installing two kits — or the same kit twice — can never collide.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const many = (name) => args.reduce((acc, a, i) => (a === name ? [...acc, args[i + 1]] : acc), []);
const one = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

const inputs = many('--in');
const name = one('--name', 'UI Kit');
const author = one('--author');
const description = one('--description', `UI captured from an existing game and packaged for reuse.`);
const outFile = one('--out', 'ui-kit.nfpack');
assert.ok(inputs.length, 'Pass at least one --in <captured UIDocument json>');

const uiDocuments = [];
for (const input of inputs) {
  const doc = JSON.parse(await readFile(resolve(input), 'utf8'));
  assert.ok(doc.root && doc.name, `${input} does not look like a captured UIDocument`);
  uiDocuments.push(doc);
}

const pkg = {
  format: 'nodeforge-package',
  formatVersion: '1.0.0',
  kind: 'asset',
  meta: {
    id: `pkg-${randomUUID()}`,
    name,
    description,
    ...(author ? { author } : {}),
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    tags: ['ui', 'hud', 'kit'],
  },
  content: {
    prefabs: [],
    blueprints: [],
    graphs: [],
    materials: [],
    particleSystems: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    dataAssets: [],
    uiDocuments,
    variables: [],
  },
  assets: [],
};

await writeFile(resolve(outFile), JSON.stringify(pkg, null, 2));
const elements = uiDocuments.reduce((total, doc) => {
  const count = (node) => 1 + node.children.reduce((sub, child) => sub + count(child), 0);
  return total + count(doc.root);
}, 0);
const css = uiDocuments.reduce((total, doc) => total + (doc.css?.length ?? 0), 0);
process.stderr.write(
  `Packed "${name}": ${uiDocuments.length} UI doc(s), ${elements} elements, ${(css / 1024).toFixed(0)}KB CSS → ${outFile}\n`,
);
