import { describe, expect, it } from 'vitest';
// The doctor is a plain-node script (it shells out to rustc/xcodebuild/etc.), but its report
// shape is a frontend contract: the export dialog's platform picker renders it verbatim.
// @ts-expect-error — plain .mjs module without type declarations
import { diagnosePlatforms } from '../../../scripts/platform-doctor.mjs';
import type { ExportPlatformsReport } from '../types';

describe('platform doctor report contract', () => {
  const report = diagnosePlatforms() as ExportPlatformsReport;

  it('covers all six export platforms exactly once', () => {
    expect(report.platforms.map((platform) => platform.id).sort()).toEqual(
      ['android', 'ios', 'linux', 'macos', 'web', 'windows'].sort(),
    );
  });

  it('web is always ready', () => {
    expect(report.platforms.find((platform) => platform.id === 'web')?.status).toBe('ready');
  });

  it('non-host desktop platforms are CI, the host is locally buildable or missing tools', () => {
    const hostId = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
    for (const platform of report.platforms) {
      if (platform.kind !== 'desktop') continue;
      if (platform.id === hostId) expect(['ready', 'missing']).toContain(platform.status);
      else expect(platform.status).toBe('ci');
    }
  });

  it('every unmet requirement carries a fix hint', () => {
    for (const platform of report.platforms) {
      for (const requirement of platform.requirements) {
        expect(typeof requirement.ok).toBe('boolean');
        if (!requirement.ok) expect(requirement.fix).toBeTruthy();
      }
    }
  });

  it('statuses are within the picker enum', () => {
    for (const platform of report.platforms) {
      expect(['ready', 'ci', 'missing', 'unsupported']).toContain(platform.status);
    }
  });
});
