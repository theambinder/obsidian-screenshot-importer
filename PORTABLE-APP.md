# Portable macOS Application

## Quick Start

1. Download `Obsidian-Screenshot-Importer-1.4.0-Apple-Silicon.zip` from [GitHub Releases](https://github.com/theambinder/obsidian-screenshot-importer/releases), or transfer a locally built `dist` ZIP to the other Mac (AirDrop, iCloud Drive, or external drive).
2. Put the ZIP in **Downloads**, unzip it there, open the release folder, and drag **Obsidian Screenshot Importer.app** into **Applications**. Keep a local copy of the app on each Mac, rather than launching a partially downloaded app bundle from iCloud. The companion `Sources-1.4.0.zip` is not required to run the app; keep it with the distribution for source access and redistribution.
3. Open the app. There is no Terminal window, installer, Homebrew, Node.js setup, or separate server to start.
4. Close the main window or press **Cmd+Q** when finished. The owned local service exits too. An active import, rollback, or Trash operation is allowed to finish first. Do not force-quit or put the Mac to sleep while it finishes.

Requirements: **Apple Silicon (M1 or later), macOS 13.5 or later**. This is not an Intel/universal build. The complete app includes Node.js, cwebp, and FFmpeg. It works offline with files already downloaded from iCloud.

The build is ad-hoc signed, **not Apple Developer ID signed or notarized**. On another Mac, Gatekeeper may require approval in System Settings > Privacy & Security > Open Anyway ([Apple's instructions](https://support.apple.com/en-gb/102445)). Approve only the app you transferred from your own trusted copy. No disabling Gatekeeper or system-wide security changes are needed. Managed Macs may disallow unnotarized apps.

The ZIP is the canonical transfer artifact. This project's iCloud file provider can attach Finder metadata to unpacked `.app` directories, which fails strict code-signature validation. The build signs outside iCloud and puts that clean bundle into the ZIP. Strict signature validation succeeds after extraction to a local, non-iCloud folder. Keep the app itself in local Applications; only its data needs to be synced.

## Locations and Existing Data

Open **Settings > Choose Folders...**, or **Obsidian Screenshot Importer > Locations...** (Cmd+,). Choose:

- **Screenshots**: the source folder containing screenshot/image subfolders and `_archive`; the images can come from any source.
- **Obsidian Vault**: the vault root, not its Media subfolder.
- **Media**: the folder inside the vault containing Anime, Movies, Series, Cartoons, Games, Manga, and Comics. Only these categories are eligible for notes.
- **History & Settings**: the existing `data` directory, containing `runs`, `backups`, `rules.json`, and `settings.json`.

Applying locations restarts the backend and clears the current table selection. It **does not move, merge, or delete files**. Current work must finish before changing locations.

On first launch, the app uses the existing `~/Documents/Private/Projects/iina-obsidian-screenshot-importer/data` directory if present. This preserves the current history, note matching rules, category quality defaults, and rollback backups in place. Otherwise it uses `~/Library/Application Support/Obsidian Screenshot Automation/data`.

Locations are local to each Mac and stored in `~/Library/Application Support/Obsidian Screenshot Automation/locations.json`. The log is `desktop.log` next to it (rotated at 2 MB); use the app menu's **Open Log**. No mutable data is stored inside the `.app`.

Since 1.4.0 the app's visible name is **Obsidian Screenshot Importer**. The older support-directory name and bundle identifier deliberately remain unchanged so existing profiles, permissions, and history are retained. Close the old Automation app and remove that old app bundle from Applications after installing the new one; do not remove its support/data folder.

**Settings > Locations > Image Folder** changes the vault-relative output template. The default is `All Notes/Attachments/{notename}`. For example, `Images/{notename}` groups images by note, while `Images` uses a shared folder. Save before Run. Absolute paths, traversal, and unknown placeholders are rejected; the importer also checks symlink boundaries. Changes affect new imports only. Old links, images, and rollback journals remain at their existing paths.

For the current iCloud setup, choose the same existing project `data` folder on both Macs. The application itself can then be copied/replaced independently of that shared folder. **Copying only the app does not copy screenshots, the vault, history, or settings.** On a Mac without that shared folder, copy the entire `data` folder separately while the app is closed, then select it. Do not copy only run logs: rollback may require the `backups` directory too.

Old run logs contain absolute file paths. Continuing their rollback history assumes the same user name and folder paths on both Macs, as in this project's original setup. If paths differ, use the old Mac/path layout for old rollbacks; selecting new locations does not silently rewrite history. New imports use the selected locations.

**Use one Mac at a time** and wait for iCloud to finish syncing before switching. A local lock prevents two desktop copies on the same Mac from using the same history folder. iCloud is not a distributed lock or transactional database. The legacy Terminal/launcher service does not participate in this lock: close it before using the new app.

## Window Behavior

The existing Screenshots, History, Settings, compression previews, native Trash, and rollback features run in a WKWebView window. Image links open separate **Image Preview** windows. Closing an image window does not quit the app; closing the main window does. Obsidian note links open the installed Obsidian app. macOS can ask the app for permission to access protected folders or Trash.

Each section remembers its own scroll position for the current window session. Single-click a section to return to that position, or double-click to go to the top. A new app session starts fresh; these positions are not written to shared settings or history.

The backend listens only on `127.0.0.1` on an automatically assigned free port. No fixed port 3787 and no globally installed tools are required. It is owned by the native app and is shut down via a private pipe. If the host disappears unexpectedly, the backend waits for an active mutation to finish, then exits. A hard OS shutdown cannot be made transactional; retain source archives until checking the result.

## Build and Maintenance

Developer build on an Apple Silicon Mac with Apple's Command Line Tools:

```sh
/bin/bash scripts/build-macos-app.sh
```

The build downloads pinned archives to `build/downloads`, verifies SHA-256, compiles the native host and a small static FFmpeg, checks that executable dependencies do not point at Homebrew or a developer home directory, signs the app ad hoc, verifies signatures, and creates `.app` and ZIP outputs in `dist`. Re-running uses the verified download cache. `build` and `dist` are generated; never use them for user data.

Official upstream dependencies:

- [Node.js 24.21.0](https://nodejs.org/dist/v24.21.0/), official macOS arm64 binary; hash checked against upstream SHASUMS256.txt. Its Mach-O minimum system version is 13.5.
- [WebP 1.6.0](https://developers.google.com/speed/webp/download), official standalone macOS arm64 cwebp.
- [FFmpeg 7.1.5](https://ffmpeg.org/releases/), minimal LGPL static build, no network codecs or Homebrew libraries. PNG/JPEG output, PNG/JPEG/TIFF/BMP/WebP/GIF input, file protocol only; screenshot processing, not a general-purpose FFmpeg distribution.

WebP/FFmpeg archive hashes were pinned from the initial HTTPS downloads; unlike Node's hash, they were not independently signature-verified. License texts remain in `Contents/Resources/Licenses`. Matching FFmpeg/WebP source archives, native/frontend/backend sources, and build configuration are in the companion `Sources-VERSION.zip` within the main distribution ZIP. Keep that source archive when redistributing the app. Upgrading a codec requires updating the URL/hash, rebuilding, and re-running image tests. No auto-updater or network connection is used by the running app.

From 1.1.0, the build strips only debug/local symbol tables from Node before signing; it does not remove ICU, runtime code, or image codecs. This reduces installed size without requiring dependencies on the destination Mac. Symbols are still available in the pinned upstream Node archive for low-level debugging.

From 1.2.4, a small bundled `preserve-creation-time` executable copies the existing note's macOS creation timestamp onto its prepared replacement. Import and rollback keep Created Date while updating Modified Date, without abandoning atomic saves. The date is verified before rename; a preservation failure leaves the original note in place. No compiler, Xcode, Homebrew, or automation permission is needed in the portable app. This does not reconstruct dates lost by older versions or override later changes made by external editors/sync tools.

## Versions and Updates

`package.json` is the single version source. The build writes its value into both macOS version fields and the ZIP filename. Settings and About show the same version; `/api/health` exposes it for diagnostics. [CHANGELOG.md](CHANGELOG.md) records release changes using MAJOR.MINOR.PATCH. Close the old app before replacing it in Applications; the data folder is not inside the app and stays untouched.

**Settings > Parallel Images** persists Auto/1/2/3/4 in `data/settings.json`. Auto chooses up to four encoders based on CPU count, with a conservative low-memory fallback. It accelerates a batch of screenshots, not a single image. Encoders produce scratch files concurrently; filenames, backups, output publication, journal updates, and Markdown edits remain serial. Original/copy mode stays sequential. See [PERFORMANCE.md](PERFORMANCE.md) for timings and output-hash checks.

Implementation:

- `macos/DesktopApp.swift`: AppKit window, WKWebView, image windows, JS confirm/alert integration, directory picker, app menus, child process ownership, safe quit/restart.
- `macos/preserve-creation-time.c`: filesystem-only helper using `fsetattrlist(ATTR_CMN_CRTIME)`, bundled and signed alongside the converters. Never changes the source, follows symlinks, or restores an old modification time.
- `src/desktop.mjs`: private stdin/stdout JSON protocol, random-port backend, local data lock, parent-pipe monitoring, shutdown after writes finish.
- `src/desktopConfig.mjs`: local profile and migration-free discovery of the existing data folder.
- `src/server.mjs`: the same backend as browser mode; rejects new writes after a desktop shutdown begins and exposes a non-HTTP busy check to its host.
- `scripts/build-macos-app.sh`, `scripts/build-ffmpeg.sh`, `scripts/build-native-helpers.sh`: repeatable bundle build. `npm start` and `npm test` also build the helper for source-based development; direct `node` invocations require `npm run build:native` first on macOS.

The generated `macos/Obsidian Screenshot Importer.app` is a **legacy launcher**, not the portable application. It is generated by `scripts/setup-macos.zsh` from committed source templates and is excluded from Git and companion source archives. Use the new **dist** build. Source editing still happens in the project; rebuild the app after editing sources because its code is an immutable snapshot.

## Verification (2026-09-18)

Release 1.4.0 verification (2026-10-08): all 83 tests pass, including the packaged-backend test. The transfer ZIP was extracted outside iCloud and passed strict deep signature verification. A disposable native profile confirmed grouped mode changes, S2E0 and Season 3 episode detection, the editable output folder, Size sorting, and the compact window layout. A 1,001-image import and full rollback completed with results and disabled mutation buttons. No real screenshots/Media notes/history were used. The test app and owned backend exited cleanly. No second physical Mac was available.

- 43 automated tests pass, including import/rollback, desktop lifecycle, all conflict policies under parallel encoding, encoder failure, scratch cleanup, worker limits, saved settings, and matching native/backend version metadata.
- Packaged tests use only bundled executables plus `/usr/bin:/bin:/usr/sbin:/sbin`, an unrelated working directory, and disposable source/vault/history directories. WebP, JPEG, PNG, and original previews return real image bytes. An active seven-file import finishes before process exit, and rollback succeeds after restarting.
- The ZIP was extracted to a different folder (including spaces) and that copy was launched in a real macOS window with disposable fixtures. Verified compression preview, opening converted images in a separate image window, folder picker, applying locations/restarting, import, native rollback confirmation, and successful rollback.
- Cmd+Q exits the host with status 0; neither its initial port nor its post-restart port remains listening. No real notes/screenshots/history were mutated by these checks.
- Closing both parent pipes during an active import (simulated native-host crash) does not interrupt it; the backend finishes and exits without an EPIPE crash.
- Tested on the current Apple Silicon Mac. A second physical Mac and macOS 13.5 itself were not available for testing. Gatekeeper/notarization caveat still applies.
