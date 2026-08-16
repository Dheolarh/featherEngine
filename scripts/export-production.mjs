#!/usr/bin/env node
// Production export assembler for Feather Engine games.
//
// Turns a self-contained game bundle (game.json, produced by the editor's
// Production button) into shippable artifacts:
//
//   - a PORTABLE WEB FOLDER: copy of the player build with the game baked in;
//     serve the folder from any static web host (browsers restrict file:// module apps).
//   - a NATIVE APP (--native): wraps that folder in the Tauri player target,
//     producing a real .app/.dmg (mac), .msi/.exe (windows), or
//     .AppImage/.deb (linux) for the current operating system.
//   - an ANDROID APK (--android): the same player wrapped in the Tauri mobile
//     shell; requires the Android SDK/NDK (run `npm run doctor` to check).
//   - an iOS APP (--ios): Xcode-built via the Tauri mobile shell (macOS only);
//     device installs need a signing team — the Xcode project is generated
//     under src-tauri/gen/apple either way.
//
// Usage:
//   node scripts/export-production.mjs [--bundle <game.json>] [--name "<Game>"]
//                                      [--out <dir>] [--native] [--android] [--ios]
//                                      [--fast] [--skip-build] [--zip] [--open]
//
// Defaults: --bundle exports/staging/game.json, --out exports/
import { execFileSync } from 'node:child_process';
import { findAndroidSdk, findAndroidNdk } from './platform-doctor.mjs';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function slugify(name) {
  return (
    String(name || 'game')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'game'
  );
}

function run(cmd, args, env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const options = { cwd: root, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env };
  if (process.platform === 'win32') {
    const quote = (part) => {
      const text = String(part);
      return /[\s&()^%!<>|"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    execFileSync('cmd.exe', ['/d', '/c', [cmd, ...args].map(quote).join(' ')], options);
    return;
  }
  execFileSync(cmd, args, options);
}

function openPath(path) {
  try {
    if (process.platform === 'win32') execFileSync('explorer.exe', [path], { stdio: 'ignore' });
    else if (process.platform === 'darwin') execFileSync('open', [path], { stdio: 'ignore' });
    else execFileSync('xdg-open', [path], { stdio: 'ignore' });
  } catch {
    console.warn(`Could not open ${path}.`);
  }
}

function collectInstallers(bundleDir) {
  if (!existsSync(bundleDir)) return [];
  const wanted = /\.(dmg|app|msi|exe|AppImage|deb|rpm)$/i;
  const found = [];
  for (const sub of readdirSync(bundleDir)) {
    const subDir = resolve(bundleDir, sub);
    if (!statSync(subDir).isDirectory()) continue;
    for (const entry of readdirSync(subDir)) {
      if (wanted.test(entry)) found.push(resolve(subDir, entry));
    }
  }
  return found;
}

/** Recursively find files matching `pattern` under `dir` (mobile build outputs move around). */
function findArtifacts(dir, pattern, depth = 8) {
  if (depth < 0 || !existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) found.push(...findArtifacts(full, pattern, depth - 1));
    else if (pattern.test(entry)) found.push(full);
  }
  return found;
}

/** Copy build artifacts into a fresh `<out>/<slug>-<suffix>/` folder; returns the folder or null. */
function copyArtifacts(files, outRoot, slug, suffix) {
  if (!files.length) return null;
  const dest = resolve(outRoot, `${slug}-${suffix}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const src of files) cpSync(src, resolve(dest, basename(src)), { recursive: true });
  return dest;
}

function injectBundleScript(html, title) {
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${title.replace(/[<>&]/g, '')}</title>`);
  if (!out.includes('game-bundle.js')) {
    out = out.replace(/(<script\b[^>]*\bsrc=)/i, '<script src="./game-bundle.js"></script>\n    $1');
  }
  return out;
}

function zipFolder(webOut) {
  const zipPath = `${webOut}.zip`;
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    const stage = mkdtempSync(join(tmpdir(), 'feather-export-'));
    try {
      const stagedWeb = resolve(stage, basename(webOut));
      cpSync(webOut, stagedWeb, { recursive: true });
      run('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${stagedWeb}' -DestinationPath '${zipPath}'`,
      ]);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: webOut, stdio: 'inherit' });
  }
  console.log(`\nOK: Zipped -> ${zipPath}`);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const opts = parseArgs(process.argv.slice(2));
const bundlePath = resolve(root, opts.bundle || 'exports/staging/game.json');
const outRoot = resolve(root, opts.out || 'exports');
const distPlayer = resolve(root, 'dist-player');

/**
 * Run the exact TypeScript/Zod loader and bundle auditor used by the editor/player. Vite is already
 * a direct build dependency and its SSR loader lets this plain Node CLI reuse that source of truth
 * instead of maintaining a weaker second "looks roughly valid" schema in this script.
 */
async function validateAndAuditBundle(raw) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    const [bundleModule, auditModule] = await Promise.all([
      vite.ssrLoadModule('/src/project/exportGame.ts'),
      vite.ssrLoadModule('/src/project/verifyBundle.ts'),
    ]);
    const loaded = bundleModule.readGameBundle(raw);
    const canonicalBundle = {
      bundleVersion: bundleModule.GAME_BUNDLE_VERSION,
      startSceneId: loaded.startSceneId,
      project: loaded.project,
    };
    return { loaded, report: auditModule.verifyGameBundle(canonicalBundle) };
  } finally {
    await vite.close();
  }
}

if (!existsSync(bundlePath)) {
  console.error(
    `\nERROR: No game bundle found at ${bundlePath}\n` +
      '  Export one from the editor Production button, or pass --bundle <game.json>.\n',
  );
  process.exit(1);
}

const bundleRaw = readFileSync(bundlePath, 'utf8');
let bundle;
try {
  bundle = JSON.parse(bundleRaw);
} catch (err) {
  console.error(`\nERROR: ${bundlePath} is not valid JSON: ${err.message}\n`);
  process.exit(1);
}

let preflight;
try {
  preflight = await validateAndAuditBundle(bundle);
} catch (err) {
  console.error(
    `\nERROR: ${bundlePath} cannot be loaded by this Feather Engine player:\n` +
      `  ${err instanceof Error ? err.message : String(err)}\n` +
      '  Open and re-export the project with this engine version, then try again.\n',
  );
  process.exit(1);
}

const gameName = opts.name || preflight.loaded.project.name || 'Game';
const slug = slugify(gameName);

{
  const p = preflight.loaded.project;
  const objectCount = (p.scenes ?? []).reduce((n, scene) => n + (scene.objects?.length ?? 0), 0);
  const assets = p.assets ?? [];
  console.log(
    `\nContents: ${(p.scenes ?? []).length} scenes / ${objectCount} objects | ` +
      `${(p.blueprints ?? []).length} blueprints | ${(p.materials ?? []).length} materials | ` +
      `${(p.particleSystems ?? []).length} particles | ${(p.prefabs ?? []).length} prefabs | ` +
      `${assets.length} resources`,
  );
  for (const warning of preflight.report.warnings) console.warn(`WARNING: ${warning}`);
  if (preflight.report.errors.length) {
    console.error(`\nERROR: Production preflight found ${preflight.report.errors.length} blocking issue(s):`);
    for (const error of preflight.report.errors) console.error(`   - ${error}`);
    console.error('\nFix these resources in the editor and export a new game.json. No player files were written.\n');
    process.exit(1);
  }
  if (assets.length && !preflight.report.warnings.length) {
    console.log('OK: All shipped resources are embedded and production-safe.');
  }
}

if (!opts['skip-build']) {
  run(npmCmd, ['run', opts.fast ? 'build:player:fast' : 'build:player']);
} else if (!existsSync(distPlayer)) {
  console.error('\nERROR: --skip-build was set but dist-player/ does not exist. Build it first.\n');
  process.exit(1);
} else {
  console.log('\nReusing existing dist-player/ (--skip-build).');
}

const bundleJs = `window.__NODEFORGE_GAME__ = ${JSON.stringify(bundle)};\n`;
const webOut = resolve(outRoot, `${slug}-web`);
rmSync(webOut, { recursive: true, force: true });
mkdirSync(webOut, { recursive: true });
cpSync(distPlayer, webOut, { recursive: true });
writeFileSync(resolve(webOut, 'game-bundle.js'), bundleJs);
const webIndex = resolve(webOut, 'index.html');
writeFileSync(webIndex, injectBundleScript(readFileSync(webIndex, 'utf8'), gameName));
writeFileSync(
  resolve(webOut, 'README.txt'),
  `${gameName}\n${'='.repeat(gameName.length)}\n\n` +
    'Web build: upload/serve this entire folder from any static web server.\n' +
    'Do not open index.html with file://; browsers block module/resource loading there.\n' +
    'For a standalone installable application, build the Tauri native target.\n\n' +
    'Built with Feather Engine. Re-export from the editor to update.\n',
);
console.log(`\nOK: Hosted web build -> ${webOut}`);

/** Bake the game bundle into dist-player, run `fn`, then restore dist-player so repeated
 *  exports never leave game-specific files in the reusable player build. */
function withBakedBundle(fn) {
  const distIndex = resolve(distPlayer, 'index.html');
  const distBundle = resolve(distPlayer, 'game-bundle.js');
  const indexBefore = readFileSync(distIndex, 'utf8');
  const hadBundle = existsSync(distBundle);
  const bundleBefore = hadBundle ? readFileSync(distBundle, 'utf8') : null;
  try {
    writeFileSync(distBundle, bundleJs);
    writeFileSync(distIndex, injectBundleScript(indexBefore, gameName));
    fn();
  } finally {
    writeFileSync(distIndex, indexBefore);
    if (hadBundle) writeFileSync(distBundle, bundleBefore);
    else rmSync(distBundle, { force: true });
  }
}

const PLAYER_CONFIG = 'src-tauri/tauri.player.conf.json';

if (opts.native) {
  withBakedBundle(() => {
    run(npmCmd, ['run', 'tauri', '--', 'build', '--config', PLAYER_CONFIG]);
  });

  const bundleDir = resolve(root, 'src-tauri/target/release/bundle');
  console.log(`\nOK: Native build complete. Installers are in:\n  ${bundleDir}/`);

  const nativeOut = copyArtifacts(collectInstallers(bundleDir), outRoot, slug, 'native');
  if (nativeOut) console.log(`OK: Native app copied -> ${nativeOut}`);
  else console.warn('WARNING: No native installers were found to copy.');
}

if (opts.android) {
  const sdk = findAndroidSdk();
  const ndk = findAndroidNdk(sdk);
  if (!sdk || !ndk) {
    console.error(
      '\nERROR: Android SDK/NDK not found. Install Android Studio (with an NDK via the SDK Manager)\n' +
        '  or set ANDROID_HOME / NDK_HOME. Run `npm run doctor` for a full checklist.\n',
    );
    process.exit(1);
  }
  const androidEnv = {
    ANDROID_HOME: process.env.ANDROID_HOME || sdk,
    NDK_HOME: process.env.NDK_HOME || ndk,
  };

  if (!existsSync(resolve(root, 'src-tauri/gen/android'))) {
    console.log('\nInitializing the Android project (first run only)…');
    run(npmCmd, ['run', 'tauri', '--', 'android', 'init', '--ci', '--config', PLAYER_CONFIG], androidEnv);
  }

  withBakedBundle(() => {
    run(npmCmd, ['run', 'tauri', '--', 'android', 'build', '--apk', '--config', PLAYER_CONFIG], androidEnv);
  });

  const outputs = resolve(root, 'src-tauri/gen/android/app/build/outputs');
  const apks = findArtifacts(outputs, /\.(apk|aab)$/i);
  const androidOut = copyArtifacts(apks, outRoot, slug, 'android');
  if (androidOut) {
    console.log(`\nOK: Android build copied -> ${androidOut}`);
    if (apks.some((file) => /unsigned/i.test(basename(file)))) {
      console.log(
        '  NOTE: the APK is unsigned. For sideloading/testing, configure a debug keystore, or set up\n' +
          '  release signing for the Play Store: https://v2.tauri.app/distribute/sign/android/',
      );
    }
  } else {
    console.warn('WARNING: No .apk/.aab artifacts were found under src-tauri/gen/android.');
  }
}

if (opts.ios) {
  if (process.platform !== 'darwin') {
    console.error('\nERROR: iOS builds require macOS with Xcode installed.\n');
    process.exit(1);
  }

  if (!existsSync(resolve(root, 'src-tauri/gen/apple'))) {
    console.log('\nInitializing the iOS Xcode project (first run only)…');
    run(npmCmd, ['run', 'tauri', '--', 'ios', 'init', '--ci', '--config', PLAYER_CONFIG]);
  }

  let iosBuildFailed = false;
  withBakedBundle(() => {
    try {
      run(npmCmd, ['run', 'tauri', '--', 'ios', 'build', '--export-method', 'debugging', '--config', PLAYER_CONFIG]);
    } catch {
      iosBuildFailed = true;
    }
  });

  const ipas = findArtifacts(resolve(root, 'src-tauri/gen/apple'), /\.ipa$/i);
  const iosOut = copyArtifacts(ipas, outRoot, slug, 'ios');
  if (iosOut) {
    console.log(`\nOK: iOS build copied -> ${iosOut}`);
  } else {
    console.warn(
      `\n${iosBuildFailed ? 'The iOS command-line build did not finish (usually a signing-team issue).' : 'No .ipa was produced.'}\n` +
        '  The Xcode project is ready: open src-tauri/gen/apple in Xcode, pick your team under\n' +
        '  Signing & Capabilities, then build/run on a device or simulator.\n' +
        '  (A free Apple ID works for on-device testing.)',
    );
    if (iosBuildFailed) process.exitCode = 1;
  }
}

if (opts.zip) zipFolder(webOut);
if (opts.open) openPath(webOut);

console.log('\nDone. Share the web folder/zip, or install the native app from the native output folder.\n');
