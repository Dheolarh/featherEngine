#!/usr/bin/env node
// Platform doctor for Feather Engine exports.
//
// Inspects this machine's toolchains and reports, per export platform, whether a
// build can run locally right now, what is missing (with fix hints), or whether
// the platform should be built on CI instead.
//
// Usage:
//   node scripts/platform-doctor.mjs          # human-readable report
//   node scripts/platform-doctor.mjs --json   # machine-readable (editor UI reads this)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function capture(cmd, args = []) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 })
      .trim();
  } catch {
    return null;
  }
}

function firstExistingDir(paths) {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function findAndroidSdk(env = process.env) {
  return firstExistingDir([
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    process.platform === 'darwin' ? join(homedir(), 'Library/Android/sdk') : null,
    process.platform === 'win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    join(homedir(), 'Android/Sdk'),
  ]);
}

export function findAndroidNdk(sdkPath, env = process.env) {
  if (env.NDK_HOME && existsSync(env.NDK_HOME)) return env.NDK_HOME;
  if (env.ANDROID_NDK_HOME && existsSync(env.ANDROID_NDK_HOME)) return env.ANDROID_NDK_HOME;
  if (!sdkPath) return null;
  const ndkRoot = join(sdkPath, 'ndk');
  if (!existsSync(ndkRoot)) return null;
  const versions = readdirSync(ndkRoot)
    .filter((entry) => !entry.startsWith('.'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  return versions.length ? join(ndkRoot, versions[versions.length - 1]) : null;
}

function directoryHas(path, predicate = () => true) {
  if (!path || !existsSync(path)) return false;
  try {
    return readdirSync(path).some(predicate);
  } catch {
    return false;
  }
}

function javaMajorVersion() {
  // java prints its version banner on stderr, so capture both streams.
  const result = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) return null;
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = /version "(\d+)/.exec(text) || /openjdk (\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

function installedRustTargets() {
  const out = capture('rustup', ['target', 'list', '--installed']);
  return out ? new Set(out.split('\n').map((line) => line.trim())) : new Set();
}

function hasIosSimulatorRuntime() {
  const out = capture('xcrun', ['simctl', 'list', 'runtimes', '--json']);
  if (!out) return false;
  try {
    const runtimes = JSON.parse(out).runtimes;
    return Array.isArray(runtimes) && runtimes.some((runtime) => {
      const identity = `${runtime?.identifier ?? ''} ${runtime?.name ?? ''}`.toLowerCase();
      const unavailable = runtime?.isAvailable === false || /unavailable/i.test(String(runtime?.availability ?? ''));
      return identity.includes('ios') && !unavailable;
    });
  } catch {
    return false;
  }
}

export function hasAppleCodeSigningIdentity(configuration = 'debug') {
  const out = capture('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (!out || /\b0 valid identities found\b/i.test(out)) return false;
  if (configuration === 'release') return /Apple Distribution:|iPhone Distribution:/i.test(out);
  return /Apple (?:Development|Distribution):|iPhone (?:Developer|Distribution):/i.test(out);
}

/** Resolve a deterministic macOS signing identity, preferring the caller's explicit CI choice. */
export function findMacCodeSigningIdentity(env = process.env) {
  const explicit = env.APPLE_SIGNING_IDENTITY?.trim();
  if (explicit) return explicit;
  const out = capture('security', ['find-identity', '-v', '-p', 'codesigning']);
  const match = out?.match(/"(Developer ID Application:[^"]+)"/i);
  return match?.[1] ?? null;
}

const DESKTOP_LABELS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Full toolchain + platform diagnosis. Everything the export UI needs, one call. */
export function diagnosePlatforms() {
  const host = process.platform;
  const rustc = capture('rustc', ['--version']);
  const tauriCli = existsSync(join(root, 'node_modules', '@tauri-apps', 'cli', 'package.json'));
  const rustTargets = installedRustTargets();

  const requirement = (id, label, ok, fix) => ({ id, label, ok: Boolean(ok), ...(ok ? {} : { fix }) });
  const statusOf = (requirements) => (requirements.every((r) => r.ok) ? 'ready' : 'missing');

  const desktopBase = [
    requirement('rust', 'Rust toolchain (rustc + cargo)', rustc, 'Install from https://rustup.rs'),
    requirement('tauri-cli', 'Tauri CLI (node_modules)', tauriCli, 'Run: npm install'),
  ];

  const platforms = [];

  platforms.push({
    id: 'web',
    label: 'Web',
    kind: 'web',
    status: 'ready',
    requirements: [],
    notes: 'Portable folder + zip. Runs in any modern browser; host it on any static server.',
  });

  for (const os of ['darwin', 'win32', 'linux']) {
    const isHost = host === os;
    const id = os === 'darwin' ? 'macos' : os === 'win32' ? 'windows' : 'linux';
    if (isHost) {
      const requirements = [...desktopBase];
      if (os === 'linux') {
        const webkit = capture('pkg-config', ['--exists', 'webkit2gtk-4.1']) !== null;
        requirements.push(
          requirement('webkit2gtk', 'webkit2gtk-4.1 dev libraries', webkit,
            'Install your distro\'s webkit2gtk-4.1 + libappindicator dev packages'),
        );
      }
      platforms.push({
        id,
        label: DESKTOP_LABELS[os],
        kind: 'desktop',
        status: statusOf(requirements),
        requirements,
        notes: 'Builds a native installer on this machine.',
      });
    } else {
      platforms.push({
        id,
        label: DESKTOP_LABELS[os],
        kind: 'desktop',
        status: 'ci',
        requirements: [],
        notes: `Tauri cannot cross-compile; build ${DESKTOP_LABELS[os]} installers on a ${DESKTOP_LABELS[os]} machine or via the GitHub Actions workflow (.github/workflows/export-desktop.yml).`,
      });
    }
  }

  {
    const sdk = findAndroidSdk();
    const ndk = findAndroidNdk(sdk);
    const java = javaMajorVersion();
    const sdkPlatform = directoryHas(sdk ? join(sdk, 'platforms') : null, (entry) => /^android-\d+$/i.test(entry));
    const buildTools = directoryHas(sdk ? join(sdk, 'build-tools') : null);
    const platformTools = Boolean(sdk && existsSync(join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')));
    const licenses = directoryHas(sdk ? join(sdk, 'licenses') : null);
    const androidRustTargets = [
      'aarch64-linux-android',
      'armv7-linux-androideabi',
      'i686-linux-android',
      'x86_64-linux-android',
    ];
    const targetOk = androidRustTargets.every((target) => rustTargets.has(target));
    const requirements = [
      ...desktopBase,
      requirement('android-sdk', 'Android SDK', sdk, 'Install Android Studio (or SDK cmdline-tools) and set ANDROID_HOME'),
      requirement('android-platform', 'Android SDK platform', sdkPlatform, 'Install a current Android SDK Platform in Android Studio SDK Manager'),
      requirement('android-build-tools', 'Android SDK Build-Tools', buildTools, 'Install Android SDK Build-Tools in Android Studio SDK Manager'),
      requirement('android-platform-tools', 'Android SDK Platform-Tools', platformTools, 'Install Android SDK Platform-Tools in Android Studio SDK Manager'),
      requirement('android-licenses', 'Accepted Android SDK licenses', licenses, 'Run sdkmanager --licenses (or accept licenses in Android Studio)'),
      requirement('android-ndk', 'Android NDK', ndk, 'Install an NDK via Android Studio SDK Manager (or set NDK_HOME)'),
      requirement('java', 'Java 17+', java != null && java >= 17, 'Install JDK 17+ (Android Studio bundles one)'),
      requirement('rust-android', 'Rust Android targets', targetOk,
        'Run: rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android'),
    ];
    platforms.push({
      id: 'android',
      label: 'Android',
      kind: 'mobile',
      status: statusOf(requirements),
      requirements,
      sdkPath: sdk ?? undefined,
      ndkPath: ndk ?? undefined,
      notes: 'Builds a debug APK or release AAB. Play Store uploads require your release keystore/signing configuration.',
    });
  }

  if (host === 'darwin') {
    const xcode = capture('xcodebuild', ['-version']);
    const pods = capture('pod', ['--version']);
    const iosRuntime = hasIosSimulatorRuntime();
    const signingIdentity = hasAppleCodeSigningIdentity('debug');
    const targetOk = rustTargets.has('aarch64-apple-ios') && rustTargets.has('aarch64-apple-ios-sim');
    const requirements = [
      ...desktopBase,
      requirement('xcode', 'Xcode', xcode, 'Install Xcode from the App Store, then run: sudo xcodebuild -license accept'),
      requirement('ios-simulator', 'iOS Simulator runtime', iosRuntime,
        'Open Xcode → Settings → Components and download an iOS Simulator runtime'),
      requirement('cocoapods', 'CocoaPods', pods, 'Run: brew install cocoapods'),
      requirement('rust-ios', 'Rust iOS targets', targetOk,
        'Run: rustup target add aarch64-apple-ios aarch64-apple-ios-sim'),
      requirement('ios-signing', 'Apple iOS code-signing identity', signingIdentity,
        'Add your Apple ID/team in Xcode and install an Apple Development or Distribution certificate'),
    ];
    platforms.push({
      id: 'ios',
      label: 'iOS',
      kind: 'mobile',
      status: statusOf(requirements),
      requirements,
      xcodeVersion: xcode ? xcode.split('\n')[0] : undefined,
      notes: 'Generates an Xcode project; device installs need an Apple Developer signing team (free account works for testing).',
    });
  } else {
    platforms.push({
      id: 'ios',
      label: 'iOS',
      kind: 'mobile',
      status: 'unsupported',
      requirements: [],
      notes: 'iOS apps can only be built on a Mac with Xcode.',
    });
  }

  return {
    host,
    hostLabel: DESKTOP_LABELS[host] ?? host,
    rust: rustc ?? undefined,
    platforms,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = diagnosePlatforms();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const icon = { ready: 'OK ', ci: 'CI ', missing: '-- ', unsupported: 'X  ' };
    console.log(`\nFeather Engine platform doctor (host: ${report.hostLabel})\n`);
    for (const platform of report.platforms) {
      console.log(`${icon[platform.status]}${platform.label.padEnd(8)} ${platform.status.toUpperCase()}`);
      for (const req of platform.requirements) {
        console.log(`     ${req.ok ? '+' : '!'} ${req.label}${req.ok || !req.fix ? '' : ` — ${req.fix}`}`);
      }
      if (platform.notes) console.log(`     ${platform.notes}`);
    }
    console.log('');
  }
}
