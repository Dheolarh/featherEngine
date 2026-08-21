import { describe, expect, it } from 'vitest';
import { blankProject, migrateLoaded } from '../serialize';
import {
  activeExportProfile,
  createDefaultExportSettings,
  parseExportSettings,
  retargetDeletedScene,
  validateExportProfile,
} from '../exportProfiles';
import { buildGameBundle } from '../exportGame';

describe('production export profiles', () => {
  it('creates a portable, stable application identity and explicit launch scene', () => {
    const settings = createDefaultExportSettings('Sky Harbor!', 'scene-main');
    const profile = activeExportProfile(settings);

    expect(profile.targets).toEqual(['web']);
    expect(profile.startSceneId).toBe('scene-main');
    expect(profile.application.identifier).toBe('com.thedevrealm.skyharbor');
    expect(validateExportProfile(profile, ['scene-main'])).toEqual([]);
  });

  it('migrates missing settings and retargets a deleted launch scene', () => {
    const migrated = parseExportSettings(undefined, 'Legacy Game', ['scene-a', 'scene-b'], 'scene-b');
    const retargeted = retargetDeletedScene(migrated, 'scene-a', 'scene-b');

    expect(activeExportProfile(migrated).startSceneId).toBe('scene-b');
    expect(activeExportProfile(retargeted).startSceneId).toBe('scene-b');
  });

  it('preserves the active scene as the launch scene when migrating a legacy project', () => {
    const legacy = blankProject('Legacy Scenes') as unknown as Omit<
      ReturnType<typeof blankProject>,
      'exportSettings'
    > & {
      exportSettings?: ReturnType<typeof blankProject>['exportSettings'];
    };
    legacy.scenes.push({ id: 'scene-second', name: 'Second', objects: [] });
    legacy.activeSceneId = 'scene-second';
    delete legacy.exportSettings;

    expect(activeExportProfile(migrateLoaded(legacy).exportSettings).startSceneId).toBe('scene-second');
  });

  it.each(['1.0.0-alpha..1', '1.0.0-.', '1.0.0-01'])(
    'rejects invalid SemVer %s before invoking platform tooling',
    (version) => {
      const profile = activeExportProfile(createDefaultExportSettings('Game', 'scene-main'));
      expect(
        validateExportProfile(
          { ...profile, application: { ...profile.application, version } },
          ['scene-main'],
        ),
      ).toContain('Application version must be semantic versioning such as 1.0.0.');
    },
  );

  it('requires a numeric three-part version when iOS is selected', () => {
    const profile = activeExportProfile(createDefaultExportSettings('Game', 'scene-main'));
    expect(
      validateExportProfile(
        {
          ...profile,
          targets: ['ios'],
          application: { ...profile.application, version: '1.0.0-beta.1' },
        },
        ['scene-main'],
      ),
    ).toContain('iOS versions must use three numeric parts such as 1.0.0 (no prerelease or build suffix).');
  });

  it('blocks metadata that would be rejected or interpreted differently across stores', () => {
    const profile = activeExportProfile(createDefaultExportSettings('Game', 'scene-main'));
    const errors = validateExportProfile(
      {
        ...profile,
        targets: [],
        application: {
          ...profile.application,
          identifier: 'not-a-portable-id',
          version: 'next',
          buildNumber: 2_100_000_001,
        },
        window: { ...profile.window, width: 320, minWidth: 640 },
      },
      ['scene-main'],
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('reverse-DNS'),
        expect.stringContaining('semantic versioning'),
        expect.stringContaining('2,100,000,000'),
        expect.stringContaining('Select at least one'),
        expect.stringContaining('Minimum window'),
      ]),
    );
  });

  it('uses the profile launch scene instead of the editor-active scene', () => {
    const project = blankProject('Launch Scene Test');
    project.scenes.push({ id: 'scene-release', name: 'Release', objects: [] });
    project.activeSceneId = 'scene-main';
    const profile = {
      ...activeExportProfile(project.exportSettings),
      startSceneId: 'scene-release',
      targets: ['web', 'macos'] as const,
    };

    const bundle = buildGameBundle(project, { ...profile, targets: [...profile.targets] });

    expect(bundle.startSceneId).toBe('scene-release');
    expect(bundle.project.activeSceneId).toBe('scene-main');
    expect(bundle.buildProfile.targets).toEqual(['web', 'macos']);
  });
});
