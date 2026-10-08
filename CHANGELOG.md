# Changelog

Version source: `package.json`. The same version is shown in Settings, the native About window, macOS bundle metadata, the health endpoint, and the distribution ZIP filename. Releases use MAJOR.MINOR.PATCH: breaking changes, compatible features, and fixes respectively. From 1.5.0, manual in-app GitHub updates are available. User data remains separate.

This file is the public release history. Checkouts with a private `AGENTS.local.md` also maintain their local Obsidian changelog; personal notes and instructions are not distributed.

## 1.5.0 - 2026-10-08

- Add Settings > Update and the native Check for Updates menu. List stable GitHub releases, installed/new versions, dates, and release notes in a compact window.
- Download compatible Apple Silicon updates with visible progress and mandatory size/SHA-256 verification. Restrict the repository, filenames, release channel, HTTPS redirects, response sizes, and timeouts; exclude downgrades and remote HTML.
- Add Install and Restart with native bundle/version/architecture/signature validation, staged replacement after graceful shutdown, previous-copy recovery, and backend-startup confirmation. No administrator privileges, background checks, account, telemetry, or vault-data uploads are required.
- Block overlapping update downloads, imports, rollback, archive deletion, and installation. Preserve all external settings, profiles, history, screenshots, and vault files.
- Translate the detailed specification into formal English. Retain only the funding button in the README and GitHub's funding sidebar link.
- Remove legacy shell launcher/templates, Homebrew setup, npm start, and the standalone production server entrypoint. Retain reproducible application builds, developer tests, and data compatibility paths.
- Verify all 95 automated tests, a checksum-verified GitHub download, and the complete native download/install/restart cycle using disposable fixtures. Confirm settings preservation and previous-copy cleanup without importing or modifying real media data.

## 1.4.1 - 2026-10-08

- Reject missing, empty, non-string, and traversal folder names at the item-rollback endpoint before starting a background job. A malformed item request must never become a whole-run rollback.
- Add regression coverage proving invalid requests leave notes, archives, job state, and locks unchanged, while a subsequent valid item rollback still works. All 84 tests pass against the rebuilt portable bundle.

## 1.4.0 - 2026-10-08

- Rename the native app, window, menus, web interface, and distribution to Obsidian Screenshot Importer. Retain legacy support paths and bundle identifiers so profiles and history survive the rename.
- Apply Work/Episode changes to every folder with the same exact Note and remember the mode across scans and app sessions. Fill detected numbers separately for each folder, preserving manual values and E0; unknown episodes remain blank for review. Recognize Season N, named Episode/Ep, and NxE filename patterns; explain mode detection in the selector tooltip.
- Track full-run and per-folder rollback as background jobs with live phases, step counts, ETA, completion results, and recovery after interface reload. Retry progress reads without unlocking actions or pretending the operation stopped. Block another import, rollback, or Trash operation until completion in both UI and backend.
- Add editable Settings > Locations > Image Folder, a validated vault-relative template with optional {notename}. New imports use a settings snapshot; old output files and rollback journals remain untouched.
- Rename Source to Folder and move folder size into its own sortable Size column, including compact-screen sorting.
- Remove player-specific references from the public introduction and add Buy Me a Coffee / Sponsor links and GitHub funding metadata.
- Add regression coverage for grouped modes, numeric size sorting, filename patterns, output validation/persistence, custom destinations, async rollback progress, discovery, exclusion, partial rollback, and note creation-date preservation.

## 1.3.1 - 2026-10-08

- Prepare the complete project for the `obsidian-screenshot-importer` GitHub repository, with an English README, retained Russian guide, and development instructions.
- Describe support for screenshots and images from any source; IINA remains optional.
- Add configurable source-mode paths and port through environment variables, retaining legacy defaults and existing desktop profiles.
- Generate the legacy macOS launcher from portable source templates so setup works from a fresh clone in any directory.
- Exclude personal data, matching rules, settings, backups, logs, generated apps, fixtures, and build/release artifacts from Git. Companion source archives exclude precompiled legacy apps, private local documentation, and FFmpeg's environment-dumping configure log; include build flags instead.
- Keep the full release history, requirements, audit, performance notes, build scripts, and third-party notices. Distribute the portable app through GitHub Releases.

## 1.3.0 - 2026-10-03

- Give Screenshots, History, and Settings independent scroll positions for the current app session. Unvisited sections start at the top; returning restores the last position.
- Double-click a section button to jump to its top. A single click retains ordinary navigation, and clicking the active section once does not scroll or reload it.
- Preserve the current position across Screenshots/History renders. Late History responses do not scroll another section or undo a later jump to the top.
- Add regression tests and a disposable long-list native UI fixture. Scroll positions are not persisted or synchronized between Macs.

## 1.2.4 - 2026-10-03

- Preserve the note file's existing macOS Created Date during import, per-folder rollback, and full-run rollback. Modified Date still updates with content changes.
- Keep atomic saves: transfer and verify nanosecond birthtime before replacement, preserve ordinary permission bits, and reject concurrent edits. If metadata preservation fails, keep the original note and clean up the temporary file.
- Bundle a small filesystem-only native helper; the portable app needs no new installations or automation permissions. Source start/test/setup commands build the helper with Command Line Tools.
- Add regression tests for metadata preservation, failure safety, concurrent edits, and import/rollback in the portable bundle. Dates lost in older versions are not reconstructed automatically.

## 1.2.3 - 2026-10-03

- Fix excessive empty space in the Duplicate episodes confirmation in native macOS WebKit. Size the dialog to its content instead of stretching grid rows to the maximum height.
- Limit long duplicate lists to a scrollable area while keeping the title, explanation, and Cancel / Continue Run buttons visible.
- Add a disposable native-app fixture for checking both one duplicate group and a long list without using real screenshots or notes.

## 1.2.2 - 2026-10-03

- Allow episode zero (for example S3E0) while rejecting empty or invalid episode fields. Preserve zero in the table, payload, numeric sorting, run logs, History, and note links.
- Warn before Run when selected folders share the same Note, season, and episode. List every duplicate group and its source folders, with Cancel and Continue Run actions.
- Add duplicate folders under one episode heading without losing separate archive entries or per-folder rollback. Respect padded/commented headings such as S3E00 Recap and keep E0 before E1.
- Add regression coverage for E0 filename detection, input validation, duplicate grouping, shared headings, History metadata, and individual rollback.

## 1.2.1 - 2026-10-03

- Double-click an already checked Use checkbox to clear every folder with the same Note. An unchecked starting row still selects the group; other Note selections remain unchanged.
- Align plain Screenshots column labels with sort-button labels at a shared height and vertical center.
- Replace source/archive folder symbols with Lucide folder icons and note-opening symbols with the official Obsidian mark in Screenshots and History.
- Add the Reset sort label with a single undo arrow; use a two-arrow refresh icon for both Refresh buttons.
- Bundle icon assets and license notices locally, preserving offline operation and theme compatibility.

## 1.2.0 - 2026-10-03

- Double-click Use to select all folders mapped to the same exact Note. Keep unrelated selections and exclude unmatched folders from grouping.
- Add ascending/descending natural Source and Note sorting, numeric Season and Episode sorting, and reset to original scan order. Provide a compact sorting menu on narrow screens. Shift ranges follow the visible order; Markdown episode insertion remains numeric and unchanged.
- Add System, Light, and Dark choices under Settings > Appearance. System follows macOS appearance changes live; manual choices persist in the shared settings and also update the native app window.
- Keep table nodes stable during checkbox selection so double-click is delivered reliably.
- Fix native shutdown settings flushing: await an explicit module bridge instead of attempting to access private ES-module bindings.
- Record the release history at the bottom of the requested Obsidian note while retaining this portable release-only copy.

## 1.1.0 - 2026-09-18

- Reduce the bundled Node.js executable by stripping debug/local symbol tables. Runtime code, exported symbols, internationalization data, and all converters remain included.
- Move third-party source archives and rebuild materials out of the installed app into a companion `Sources-1.1.0.zip`, included in the distribution. Keep the companion archive when redistributing the app. License notices remain inside the app as well.
- Add bounded parallel image encoding with Auto/1/2/3/4 choices in Settings. Auto adapts to CPU count and memory. The preference persists in the shared data folder.
- Keep note edits, filename conflict resolution, backups, file publication, and rollback journal updates serial and in their original order. Quality, effort, dimensions, image names, and episode ordering are unchanged.
- Display the release version in Settings and About; versioned archive names make installed and transferred builds identifiable.
- Record the producing app version and effective worker count in new run logs for future diagnostics.

## 1.0.0 - 2026-09-18

- First standalone Apple Silicon macOS app with bundled Node.js, WebP, and minimal FFmpeg.
- Native main window, separate image-preview windows, folder chooser, native confirmations, and app menus.
- Random localhost port, local data lock, history outside the app, and graceful shutdown after active operations.
- Retain the existing browser workflow, import/rollback/archive functionality, and compression preview fixes.

Before 1.0.0 the source project used the development package version `0.1.0`; there was no public release sequence. The first native bundle was labeled 1.0.0. From 1.1.0 onward the package and bundle versions are kept in sync by the build script.
