# Production Export

Feather Engine can ship a finished game to **six platforms**:

| Platform | Output | How |
| --- | --- | --- |
| Web | portable folder + zip (`<game>-web/`) | always built, everywhere |
| Windows | `.msi` / `.exe` (`<game>-native/`) | build on Windows, or CI |
| macOS | `.app` / `.dmg` (`<game>-native/`) | build on macOS, or CI |
| Linux | `.AppImage` / `.deb` (`<game>-native/`) | build on Linux, or CI |
| Android | `.apk` / `.aab` (`<game>-android/`) | Tauri mobile shell (any OS with the Android SDK/NDK) |
| iOS | `.ipa` / Xcode project (`<game>-ios/`) | Tauri mobile shell (macOS + Xcode only) |

Run **`npm run doctor`** at any time for a per-platform readiness report on the current
machine — it lists exactly what is installed, what is missing, and the command that fixes
each gap. The desktop editor shows the same report as the platform picker in the export
dialog.

Games are automatically playable on touch devices: Play mode overlays a virtual
joystick + look zone + SPRINT/USE/JUMP/FIRE buttons that feed the engine's standard
input pipes, so existing templates and key bindings work on phones with no per-game work.

## Recommended Flow

1. Open the project in the desktop editor.
2. Click **Export → Production** in the toolbar.
3. Review the Build Report and tick the platforms you want (Web is always included;
   platforms with missing toolchains show what to install; the other two desktop OSes
   point at the CI workflow).
4. Pick an output folder and wait for the build overlay to finish.
5. Share `<game>-web.zip`, install from `<game>-native/`, sideload `<game>-android/`,
   or finish iOS signing in Xcode.

The desktop editor runs builds when it is launched from the source tree and `npm`, Rust,
and platform build tools are available on PATH.

## CLI Commands

These commands read `exports/staging/game.json` by default. The editor writes that staged bundle when you use the Production flow.

```bash
npm run doctor         # per-platform toolchain report (add --json for machines)
npm run ship           # web folder + zip, then open the output folder
npm run ship:native    # web folder + zip + native Tauri app for this OS
npm run export:android # web + Android APK (Tauri mobile; needs SDK/NDK)
npm run export:ios     # web + iOS build (macOS only; generates the Xcode project)
npm run ship:fast      # rebuild player without TypeScript checking, then zip
npm run ship:reuse     # reuse existing dist-player, fastest for content-only re-exports
```

Flags compose: `node scripts/export-production.mjs --native --android --zip` builds this
desktop OS and Android in one run.

Lower-level commands are still available:

```bash
npm run export:web
npm run export:production
node scripts/export-production.mjs --bundle "path/to/game.json" --name "My Game" --zip --open
```

## Speed Guide

- Use `npm run ship:native` for the final build you give players.
- Use `npm run ship:fast` while iterating on packaging. It still rebuilds the player, but skips the TypeScript project check.
- Use `npm run ship:reuse` when only the exported game data changed and the player code did not. This reuses `dist-player/` and is the fastest path.
- Use `npm run build:player` after changing player/runtime code so `ship:reuse` has a fresh player to copy.

## How It Works

1. The editor creates a self-contained `game.json` bundle with embedded resources.
2. `scripts/export-production.mjs` checks the bundle inventory and warns about missing resources.
3. The script builds or reuses `dist-player/`.
4. It copies the player into `<out>/<game>-web`, writes `game-bundle.js`, and injects it into `index.html`.
5. With `--native`, it temporarily bakes the bundle into `dist-player/`, runs `tauri build --config src-tauri/tauri.player.conf.json`, copies installers into `<out>/<game>-native`, then restores `dist-player/`.

The restore step keeps repeated native exports from leaving game-specific generated files in the reusable player build.

## Output

- Portable web build: `exports/<game>-web/` unless `--out <dir>` is passed.
- Zip, when requested: `exports/<game>-web.zip`.
- Native installers copied for sharing: `exports/<game>-native/`.
- Raw Tauri bundle output: `src-tauri/target/release/bundle/`.

## Cross-Platform Desktop Builds (CI)

Tauri builds desktop apps for the current operating system only. To ship all three desktop
targets from one project, use the bundled GitHub Actions workflow
[.github/workflows/export-desktop.yml](../.github/workflows/export-desktop.yml):

1. Push the engine repo to GitHub.
2. In the Actions tab, run **Export Desktop Installers**, passing a `bundle_url` that points
   at your exported `game.json` (a GitHub release asset, gist raw URL, etc.) — or commit the
   staged bundle with `git add -f exports/staging/game.json` and leave the input empty.
3. Download the `game-windows`, `game-macos`, `game-linux`, and `game-web` artifacts.

The portable web build runs everywhere.

## Mobile Builds

Both mobile targets wrap the same player build in the Tauri 2 mobile shell. The
first run generates the native project under `src-tauri/gen/` (using the player config, so
the app identity is your game, not the editor) and reuses it afterwards.

**Android** (`npm run export:android`, or the Android checkbox in the editor):

- Needs: Android SDK + NDK (Android Studio's SDK Manager, or `ANDROID_HOME`/`NDK_HOME`),
  JDK 17+, and the Rust targets
  (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`).
  The export script auto-detects a standard Android Studio install even without env vars.
- Output: an `.apk` you can sideload (plus an `.aab`). Play Store uploads need release
  signing: https://v2.tauri.app/distribute/sign/android/

**iOS** (`npm run export:ios`, or the iOS checkbox — macOS only):

- Needs: Xcode, CocoaPods (`brew install cocoapods`), and
  `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
- Device installs need an Apple Developer signing team (a free Apple ID works for
  on-device testing). If the command-line build stops at signing, open
  `src-tauri/gen/apple` in Xcode, pick your team under Signing & Capabilities, and
  build/run from there — the game is already baked in.

## Packaged Editor Caveat

The one-click desktop build shells out to the local source tree, so it expects this repository, `node_modules`, `npm`, Rust, and platform build tools to be available. A standalone installed editor that is not beside the source tree should export `game.json` and use the CLI flow from the source folder.
