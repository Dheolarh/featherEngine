// Reproduce the legacy-bundle load failure with a real stack trace.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
const bundle = JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/production-smoke-game.json'), 'utf8'));
const legacy = structuredClone(bundle);
legacy.project.version = '0.2.0';
legacy.project.name = 'Portable Export Legacy Smoke';
for (const c of ['folders','dataAssets','materials','particleSystems','skeletons','skeletalMeshes','animations','animatorControllers','prefabs','treeSpecs']) delete legacy.project[c];

const { createServer } = await import('vite');
const vite = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const [m, audit] = await Promise.all([
    vite.ssrLoadModule('/src/project/exportGame.ts'),
    vite.ssrLoadModule('/src/project/verifyBundle.ts'),
  ]);
  const loaded = m.readGameBundle(legacy);
  console.log('LOADED OK');
  const P = loaded.project;
  const expected = ['assets','folders','variables','dataAssets','materials','particleSystems','skeletons','skeletalMeshes','animations','animatorControllers','uiDocuments','blueprints','graphs','prefabs','treeSpecs'];
  console.log('MISSING AFTER MIGRATION:', expected.filter((k) => !Array.isArray(P[k])).join(', ') || '(none)');
  console.log('project.version after load:', P.version);
  const canonical = { bundleVersion: m.GAME_BUNDLE_VERSION, startSceneId: loaded.startSceneId, project: loaded.project };
  const report = audit.verifyGameBundle(canonical);
  console.log('AUDIT OK', JSON.stringify(report).slice(0, 200));
} catch (err) {
  console.error('FAILED:', err?.message);
  console.error(err?.stack);
} finally { await vite.close(); }
