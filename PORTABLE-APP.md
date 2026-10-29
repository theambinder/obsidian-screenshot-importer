# Portable macOS Application

## Quick Start

1. Download `Obsidian-Screenshot-Importer-1.7.4-Apple-Silicon.zip` from [GitHub Releases](https://github.com/theambinder/obsidian-screenshot-importer/releases), or transfer a locally built `dist` ZIP to another Mac (AirDrop, iCloud Drive, or external drive).
2. Put the ZIP in **Downloads**, unzip it there, and drag **Obsidian Screenshot Importer.app** into **Applications**. The main ZIP contains only the app. Keep a local copy on each Mac, rather than launching a partially downloaded app bundle from iCloud. `Obsidian-Screenshot-Importer-1.7.4-Sources.zip` is a separate optional release asset, not required to run or update the app.
3. Open the app. There is no Terminal window, installer, Homebrew, Node.js setup, or separate server to start.
4. Close the main window or press **Cmd+Q** when finished. The owned local service exits too. An active import, rollback, or Trash operation is allowed to finish first. Do not force-quit or put the Mac to sleep while it finishes.

Requirements: **Apple Silicon (M1 or later), macOS 13.5 or later**. This is not an Intel/universal build. The complete app includes Node.js, cwebp, FFmpeg with static AOM/zimg, and the HDR JXR decoder. Image processing works offline with files already downloaded from iCloud; optional manual update checks require internet access.

The build is ad-hoc signed, **not Apple Developer ID signed or notarized**. On another Mac, Gatekeeper may require approval in System Settings > Privacy & Security > Open Anyway ([Apple's instructions](https://support.apple.com/en-gb/102445)). Only trusted release copies should be approved. No disabling Gatekeeper or system-wide security changes are needed. Managed Macs may disallow unnotarized apps.

The ZIP is the canonical transfer artifact. This project's iCloud file provider can attach Finder metadata to unpacked `.app` directories, which fails strict code-signature validation. The build signs outside iCloud and puts that clean bundle into the ZIP. Strict signature validation succeeds after extraction to a local, non-iCloud folder. Keep the app itself in local Applications; only its data needs to be synced.

## Locations and Existing Data

Open **Settings > Choose Folders...**, or **Obsidian Screenshot Importer > Locations...** (Cmd+,). Choose:

- **Screenshots**: the source folder containing screenshot/image subfolders and `_archive`; the images can come from any source.
- **Obsidian Vault**: the vault root, not its Media subfolder.
- **Media**: the folder inside the vault containing Anime, Movies, Series, Cartoons, Games, Manga, and Comics. Only these categories are eligible for notes.
- **History & Settings**: the existing `data` directory, containing `runs`, `backups`, `rules.json`, and `settings.json`.

Applying locations restarts the backend and clears the current table selection. It **does not move, merge, or delete files**. Current work must finish before changing locations.

On first launch, the app reuses a detected legacy data directory when available. This preserves history, note matching rules, category quality defaults, and rollback backups in place. Otherwise it uses `~/Library/Application Support/Obsidian Screenshot Automation/data`. Existing data can also be selected through Locations.

Locations are local to each Mac and stored in `~/Library/Application Support/Obsidian Screenshot Automation/locations.json`. The log is `desktop.log` next to it (rotated at 2 MB); use the app menu's **Open Log**. No mutable data is stored inside the `.app`.

Since 1.4.0 the app's visible name is **Obsidian Screenshot Importer**. The older support-directory name and bundle identifier deliberately remain unchanged so existing profiles, permissions, and history are retained. Close the old Automation app and remove that old app bundle from Applications after installing the new one; do not remove its support/data folder.

**Settings > Locations > Image Folder** changes the vault-relative output template. The default is `All Notes/Attachments/{notename}`. For example, `Images/{notename}` groups images by note, while `Images` uses a shared folder. Save before Run. Absolute paths, traversal, and unknown placeholders are rejected; the importer also checks symlink boundaries. Changes affect new imports only. Old links, images, and rollback journals remain at their existing paths.

When shared storage is used, select the same existing History & Settings folder on both Macs. The application itself can then be copied/replaced independently of that shared folder. **Copying only the app does not copy screenshots, the vault, history, or settings.** On a Mac without that shared folder, copy the entire data folder separately while the app is closed, then select it. Do not copy only run logs: rollback may require the `backups` directory too.

Old run logs contain absolute file paths. Continuing their rollback history assumes the same user name and folder paths on both Macs, as in this project's original setup. If paths differ, use the old Mac/path layout for old rollbacks; selecting new locations does not silently rewrite history. New imports use the selected locations.

Only one Mac should operate on synchronized data at a time, after iCloud has finished syncing. A local lock prevents two desktop copies on the same Mac from using the same history folder. iCloud is not a distributed lock or transactional database.

## Window Behavior

The existing Screenshots, History, Settings, compression previews, native Trash, and rollback features run in a WKWebView window. Image links open separate **Image Preview** windows. Closing an image window does not quit the app; closing the main window does. Obsidian note links open the installed Obsidian app. macOS can ask the app for permission to access protected folders or Trash.

Quality has detailed codec tooltips; sampled size estimates appear beneath Size.
Resolution defaults to 1080p or smaller, with Original/720p max/1080p max/1440p max/4K max choices and
sampled source → output dimensions in pixels below the selector.
No cropping or stretching is applied. Small native ImageIO/JXR metadata readers avoid
decoding every image just to detect dimensions. At most two images are encoded for
each uncached estimate; only visible table rows request this serialized background
work, which is cancelled during operations and shutdown. Preview lists estimated
folder/image sizes and exact measured samples. Apply Settings applies quality,
format, effort, and resolution to matching Note rows. JXR/PNG choices apply only
to the previewed folder. Format inherits the saved Settings default, with an
automatic Note-group override and a compact paired-source selector in the same
column. JXR remains HDR AVIF. Click a folder name to open its source directory.
Note suggestions and match badges use compact 18px pills.
Format changes automatically apply to every folder sharing its Note; no copy icon is needed.
Selected rows are tinted in both themes, with accent-filled selection totals.
Sizes use decimal Finder-compatible units. Note types/tags guide Work/Episode mode;
saved manual choices still take priority. Completed reports offer per-folder note
buttons, and Open History expands the originating Run. History triangles are larger.
Obsidian note buttons open new tabs, including links from older history. Compression
Preview uses small, visible-only thumbnails, 1600px overview proxies, and matched
center detail crops. Full-size originals/results still open separately on click.
Switching/closing cancels obsolete work and releases images; heavy rendering and
background encoding are serialized and prioritized. HDR proxies retain PQ metadata.

The first launch uses a landscape window fitted to the available screen. Later launches restore the last window size and position, including a manually chosen portrait size. Existing saved geometry is retained during updates. The table and service headers extend to the window edges; spacing stays inside cells and controls.

Each section remembers its own scroll position for the current window session. Single-click a section to return to that position, or double-click to go to the top. A new app session starts fresh; these positions are not written to shared settings or history.

The backend listens only on `127.0.0.1` on an automatically assigned free port. No fixed port 3787 and no globally installed tools are required. It is owned by the native app and is shut down via a private pipe. If the host disappears unexpectedly, the backend waits for an active mutation to finish, then exits. A hard OS shutdown cannot be made transactional; retain source archives until checking the result.

## Build and Maintenance

Developer build on an Apple Silicon Mac with Apple's Command Line Tools, CMake,
pkg-config, autoconf, automake, and GNU libtool available on PATH:

```sh
/bin/bash scripts/build-macos-app.sh
```

The build downloads pinned archives to `build/downloads`, verifies SHA-256, compiles the native host and a small static FFmpeg, checks that executable dependencies do not point at Homebrew or a developer home directory, signs the app ad hoc, verifies signatures, and creates `.app` and ZIP outputs in `dist`. Re-running uses the verified download cache. `build` and `dist` are generated; never use them for user data.

Official upstream dependencies:

- [Node.js 24.21.0](https://nodejs.org/dist/v24.21.0/), official macOS arm64 binary; hash checked against upstream SHASUMS256.txt. Its Mach-O minimum system version is 13.5.
- [WebP 1.6.0](https://developers.google.com/speed/webp/download), official standalone macOS arm64 cwebp.
- [FFmpeg 7.1.5](https://ffmpeg.org/releases/), minimal LGPL static build, no network codecs or Homebrew libraries. PNG/JPEG/AVIF output, PNG/JPEG/TIFF/BMP/WebP/GIF input, raw planar-float processing, file protocol only; screenshot processing, not a general-purpose FFmpeg distribution.
- [AOM 3.12.1](https://aomedia.googlesource.com/aom/+/refs/tags/v3.12.1), static AV1 encoder/decoder, including 10-bit 4:4:4 still images. BSD license and patent notice retained.
- [zimg 3.0.6](https://github.com/sekrit-twc/zimg/tree/release-3.0.6), static color conversion for linear scRGB to BT.2020/PQ with an 80-nit reference white. WTFPL license retained.
- [Microsoft jxrlib](https://github.com/4creators/jxrlib/tree/f7521879862b9085318e814c6157490dd9dbbdb4), pinned BSD-2-Clause codec linked into the small `jxr-decode` helper. Only opaque floating-point scRGB captures are supported; no Python runtime is required.

Codec archive hashes were pinned from HTTPS downloads; unlike Node's hash, they were not independently signature-verified. License texts remain in `Contents/Resources/Licenses`, with the exact corresponding-source download link in `Source-Access.txt`. Matching FFmpeg/WebP/AOM/zimg/jxrlib source archives, native/frontend/backend sources, and build configuration are published as `Obsidian-Screenshot-Importer-VERSION-Sources.zip`, a separate asset on the same GitHub release. From 1.5.1 the main ZIP contains only the application, and updates do not download source materials. Redistribution must retain third-party notices and corresponding source access; see [FFmpeg's distribution guidance](https://ffmpeg.org/legal.html). Upgrading a codec requires updating the URL/hash, rebuilding, and re-running image tests. Network connections are limited to explicitly requested GitHub update checks and downloads.

From 1.1.0, the build strips only debug/local symbol tables from Node before signing; it does not remove ICU, runtime code, or image codecs. This reduces installed size without requiring dependencies on the destination Mac. Symbols are still available in the pinned upstream Node archive for low-level debugging.

From 1.2.4, a small bundled `preserve-creation-time` executable copies the existing note's macOS creation timestamp onto its prepared replacement. Import and rollback keep Created Date while updating Modified Date, without abandoning atomic saves. The date is verified before rename; a preservation failure leaves the original note in place. No compiler, Xcode, Homebrew, or automation permission is needed in the portable app. This does not reconstruct dates lost by older versions or override later changes made by external editors/sync tools.

## Versions and Updates

`package.json` is the single version source. The build writes its value into both macOS version fields and the ZIP filename. Settings and About show the same version; `/api/health` exposes it for diagnostics. [CHANGELOG.md](CHANGELOG.md) records release changes using MAJOR.MINOR.PATCH. Close the old app before replacing it in Applications; the data folder is not inside the app and stays untouched.

From 1.5.0, open **Settings > Update** or **Check for Updates...** in the application menu. The window lists stable releases and their GitHub release notes. **Download Update** streams the latest compatible version to the local support folder and verifies its size and SHA-256 digest. **Install and Restart** revalidates the archive, checks the bundle identity/version, Apple Silicon architecture and strict code signature, waits for graceful shutdown, replaces the app, and opens the new version. A startup marker confirms the backend before the previous copy is removed. If replacement fails, the old bundle is restored. If startup cannot be confirmed, the previous copy is retained and its recovery path is recorded in `update.log` beside `desktop.log`.

Update installation requires a writable local application directory, normally `/Applications` or `~/Applications`. No administrator prompt is requested. Translocated, read-only, and external-volume copies cannot be replaced; move the app locally or use manual ZIP installation. New downloads and installation are blocked during imports, rollback, archive operations, and shutdown. Updates never overwrite screenshots, vault files, the local profile, or history/settings. Failed/offline/rate-limited checks do not prevent local work.

The updater uses the public [GitHub Releases API](https://docs.github.com/en/rest/releases/releases) and [release-asset digest](https://docs.github.com/en/rest/releases/assets). Drafts, prereleases, downgrades, unexpected filenames, oversized downloads, and untrusted redirects are rejected. Release notes render as text, not remote HTML. HTTPS and the digest validate transport integrity; this ad-hoc-signed app does not have a separately signed publisher feed or Apple notarization. GitHub/repository security is part of the trust model. No automatic background checks, telemetry, GitHub login, or vault-data uploads are performed.

Versions before 1.5.0 require one manual update to install the updater.

**Settings > Parallel Images** persists Auto/1/2/3/4 in `data/settings.json`. Auto chooses up to four encoders based on CPU count, with a conservative low-memory fallback. It accelerates a batch of screenshots, not a single image. Encoders produce scratch files concurrently; filenames, backups, output publication, journal updates, and Markdown edits remain serial. Original/copy mode stays sequential. See [PERFORMANCE.md](PERFORMANCE.md) for timings and output-hash checks.

Implementation:

- `macos/DesktopApp.swift`: AppKit window, WKWebView, image windows, JS confirm/alert integration, directory picker, app menus, child process ownership, safe quit/restart.
- `macos/UpdateInstaller.swift`: signed, nonprivileged update validation, staged replacement, recovery and restart helper.
- `src/updates.mjs`, `public/updates.js`: fixed-repository releases, bounded verified downloads, update dialog and progress.
- `macos/preserve-creation-time.c`: filesystem-only helper using `fsetattrlist(ATTR_CMN_CRTIME)`, bundled and signed alongside the converters. Never changes the source, follows symlinks, or restores an old modification time.
- `macos/jxr-decode.c`, `scripts/build-hdr-codecs.sh`: native floating-point HDR decoder and pinned static codec builds. `src/converter.mjs` owns PQ transformation/AVIF output; `public/imageSelection.js` shares pair policy and Quality-to-CRF mapping across frontend/backend.
- `src/desktop.mjs`: private stdin/stdout JSON protocol, random-port backend, local data lock, parent-pipe monitoring, shutdown after writes finish.
- `src/desktopConfig.mjs`: local profile and migration-free discovery of the existing data folder.
- `src/server.mjs`: imported loopback server factory; rejects new writes after a desktop shutdown/update begins and exposes a non-HTTP busy check to its host.
- `scripts/build-macos-app.sh`, `scripts/build-ffmpeg.sh`, `scripts/build-native-helpers.sh`: repeatable bundle build. `npm test` builds the metadata helper for development; direct `node` test invocations require `npm run build:native` first on macOS or the built helper on PATH.

Production launch is exclusively through the built native application. Legacy shell-launcher templates, dependency installation scripts, and the standalone server entrypoint are removed. Source changes require a rebuild because each app contains an immutable code snapshot. Existing support-directory names and journal identifiers are compatibility data, not alternative launch methods.

## Verification (2026-10-29)

Release 1.7.4 passes 152 automated tests, including the packaged backend without
external executables. Coverage includes folder-mtime ordering, landscape/portrait/
ultrawide fitting, all output formats, HDR resizing and rollback, estimate sample
limits, cache invalidation, preview reuse, cancellation/scratch cleanup, source-pair
selection, per-image preview sizes, saved format defaults, and per-item format
journals through import/rollback. Native checks confirm 18px
suggestions/badges, Size estimates, maximum-resolution labels, and pixel captions.
Responsive checks cover 320–1920px without horizontal overflow; preview Format
changes follow the selected Note group. Only disposable fixtures are used.
Additional 1.7.2 coverage verifies grouped Format scope, decimal byte formatting,
series/work metadata, bracketed bare episode numbers, saved mode priority, and
heading-specific result URIs. UI checks verify selected-row colors in both themes,
per-result note buttons, and automatic expansion of the report's Run in History.
Version 1.7.3 adds queue cancellation/priority, proxy byte limits, native overview/
crop dimensions, HDR proxy color metadata, browser image release, full-image links,
new-tab URI compatibility, and a 127-file / 3.47 GB synthetic 4K preview check.
Terminal job status is exposed only after final journal writes and lock release;
a deterministic delayed-checkpoint test covers immediate rollback after completion.
Version 1.7.4 preserves native Quality controls across repeated steps and validates
draft/commit handling and rollback navigation targets. A disposable 60-folder run
checks long reports in native WKWebView and narrow/short browser viewports, fixed
header/footer visibility after list scrolling, History targeting, and full/per-folder
rollback navigation without automatic selection. Report totals use a compact header
instead of a separate result card.

Release 1.6.0 adds synthetic scRGB captures with 1000-nit highlights and tests for
10-bit AVIF, PQ/BT.2020 metadata, 16-bit reference PNG cICP, all pair policies,
conflicting names, source preservation, rollback, and Trash of omitted counterparts.
The packaged backend exercises JXR/AVIF without Homebrew on PATH. Native WKWebView
checks confirm thumbnails, CRF display, pair selection, modal closure on Apply
Quality, and converted AVIF opening in a separate Image Preview window.
Real screenshots, Media notes, and history are not used as mutation targets.

## Earlier Verification

Release 1.4.0 verification (2026-10-08): all 83 tests pass, including the packaged-backend test. The transfer ZIP was extracted outside iCloud and passed strict deep signature verification. A disposable native profile confirmed grouped mode changes, S2E0 and Season 3 episode detection, the editable output folder, Size sorting, and the compact window layout. A 1,001-image import and full rollback completed with results and disabled mutation buttons. No real screenshots/Media notes/history were used. The test app and owned backend exited cleanly. No second physical Mac was available.

Release 1.4.1 additionally rejects malformed item-rollback requests before starting a job. All 84 tests pass against the rebuilt bundle, including the case where a missing folder must not trigger a full-run rollback.

- 43 automated tests pass, including import/rollback, desktop lifecycle, all conflict policies under parallel encoding, encoder failure, scratch cleanup, worker limits, saved settings, and matching native/backend version metadata.
- Packaged tests use only bundled executables plus `/usr/bin:/bin:/usr/sbin:/sbin`, an unrelated working directory, and disposable source/vault/history directories. WebP, JPEG, PNG, and original previews return real image bytes. An active seven-file import finishes before process exit, and rollback succeeds after restarting.
- The ZIP was extracted to a different folder (including spaces) and that copy was launched in a real macOS window with disposable fixtures. Verified compression preview, opening converted images in a separate image window, folder picker, applying locations/restarting, import, native rollback confirmation, and successful rollback.
- Cmd+Q exits the host with status 0; neither its initial port nor its post-restart port remains listening. No real notes/screenshots/history were mutated by these checks.
- Closing both parent pipes during an active import (simulated native-host crash) does not interrupt it; the backend finishes and exits without an EPIPE crash.
- Tested on the current Apple Silicon Mac. A second physical Mac and macOS 13.5 itself were not available for testing. Gatekeeper/notarization caveat still applies.
