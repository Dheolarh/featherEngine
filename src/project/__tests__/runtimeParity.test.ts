import { describe, expect, it } from 'vitest';
import smokeFixture from '../../../scripts/fixtures/production-smoke-game.json';
import type { GameBundle } from '../exportGame';
import { buildGameBundle, readGameBundle } from '../exportGame';
import { detectRuntimeFeatures } from '../runtimeCompatibility';
import { verifyGameBundle } from '../verifyBundle';

const clone = <T>(value: T): T => structuredClone(value);
const fixture = () => clone(smokeFixture) as unknown as GameBundle;

describe('editor Play / production runtime parity contract', () => {
  it('round-trips Blueprint logic, widget bindings, physics and cinematic data unchanged', () => {
    const source = fixture();
    const firstLoad = readGameBundle(source);
    const rebuilt = buildGameBundle(firstLoad.project, firstLoad.buildProfile);
    const secondLoad = readGameBundle(rebuilt);

    expect(secondLoad.startSceneId).toBe('scene-smoke');
    expect(secondLoad.project.activeSceneId).toBe('scene-decoy');
    expect(secondLoad.project.blueprints).toEqual(source.project.blueprints);
    expect(secondLoad.project.graphs).toEqual(source.project.graphs);
    expect(secondLoad.project.uiDocuments).toEqual(source.project.uiDocuments);
    expect(secondLoad.project.scenes).toEqual(source.project.scenes);
    expect(detectRuntimeFeatures(secondLoad.project)).toEqual(source.runtimeContract.requiredFeatures);
    expect(verifyGameBundle(rebuilt).errors).toEqual([]);
  });

  it('blocks a widget whose logic Blueprint would disappear in the build', () => {
    const broken = fixture();
    broken.project.uiDocuments[0]!.logicBlueprintId = 'blueprint-missing';

    expect(() => readGameBundle(broken)).toThrow(/UI document.*missing logic Blueprint/);
  });

  it('rejects bundles that require a newer or unknown player capability', () => {
    const future = fixture() as unknown as {
      runtimeContract: { version: string; requiredFeatures: string[] };
    };
    future.runtimeContract = {
      version: '2.0.0',
      requiredFeatures: [...future.runtimeContract.requiredFeatures, 'future-renderer'],
    };

    expect(() => readGameBundle(future)).toThrow(/runtime contract 2\.0\.0/);
    expect(() => readGameBundle(future)).toThrow(/future-renderer/);
  });

  it('rejects a future bundle format and current bundles missing their compatibility metadata', () => {
    const future = fixture();
    future.bundleVersion = '99.0.0';
    expect(() => readGameBundle(future)).toThrow(/newer than this player/);

    const futureProject = fixture();
    futureProject.project.version = '99.0.0';
    expect(() => readGameBundle(futureProject)).toThrow(/Project 99\.0\.0 is newer/);

    const incomplete = fixture() as unknown as Omit<GameBundle, 'runtimeContract'> & {
      runtimeContract?: GameBundle['runtimeContract'];
    };
    delete incomplete.runtimeContract;
    expect(() => readGameBundle(incomplete)).toThrow(/missing its required runtime contract/);
  });

  it('requires graph cinematic references in every scene where that graph runs', () => {
    const broken = fixture();
    broken.project.scenes[1]!.cinematics = [
      { id: 'cinematic-decoy-only', name: 'Decoy only', actions: [], duration: 1, createdAt: 1 },
    ];
    broken.project.graphs[0]!.nodes[0]!.data.cinematicId = 'cinematic-decoy-only';

    expect(() => readGameBundle(broken)).toThrow(/missing from scene "Production Smoke"/);
  });
});
