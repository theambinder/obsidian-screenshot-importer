# Project Specification

Current version: **1.5.0**. The authoritative version is `package.json`.
Canonical repository: https://github.com/theambinder/obsidian-screenshot-importer.

## Purpose and Scope

Obsidian Screenshot Importer is a standalone Apple Silicon macOS application for
batch-importing screenshots and images into existing media notes. Images may come
from any player, game, capture application, or other source. Obsidian and its Image
Converter plugin are not required for conversion or Markdown editing.

The application reviews note/episode mappings before mutation, encodes images,
adds vault-relative wiki embeds, archives originals, records durable history, and
supports per-folder and full-run rollback. Missing notes are never created; such
folders remain unselected until a note is added separately and the scan refreshed.

Public documentation is maintained in formal, impersonal English. Detailed release
history belongs in CHANGELOG.md. An ignored AGENTS.local.md may specify additional
private documentation requirements; private notes must never enter distributions.

## Locations and State

- Screenshots: root containing one subfolder per work or episode. `_archive` is
  excluded from scanning. Original filenames and dimensions are retained.
- Vault: the Obsidian vault root. Media must be inside this root.
- Media: only Anime, Movies, Series, Cartoons, Games, Manga, and Comics may be
  indexed or edited. Real-path checks reject boundary escapes through symlinks.
- Image Folder: a vault-relative directory template, default
  `All Notes/Attachments/{notename}`. `{notename}` is the note filename without
  `.md`. `Images/{notename}` and a shared `Images` directory are supported.
  Absolute paths, traversal, unknown placeholders, backslashes, empty components,
  and control characters are rejected. Changes affect future imports only.
- History & Settings: external data directory containing settings.json, rules.json,
  runs, and backups. No user data is written inside the application bundle.

The native local profile records folder locations. Legacy support paths and bundle
identifiers remain intentionally stable so existing permissions, settings, and
absolute-path rollback journals continue working. Existing state must not be moved
or renamed automatically. Fresh application installations use local support data.

Sharing data between Macs requires compatible absolute paths for old journals.
Only one Mac should operate on synchronized data at a time; iCloud is not a
distributed lock. The native backend holds a per-data-directory local process lock.

## Matching and Episode Detection

`src/mediaIndex.mjs` indexes eligible Markdown notes and frontmatter aliases.
`src/matcher.mjs` normalizes release filenames, removes technical/release labels,
compares note candidates, and applies saved source-title mappings before fuzzy
matching. Confidence is heuristic, not a calibrated statistical probability.
Note labels include the category initial to distinguish identically named works.

Supported episode patterns include S01E03, 2x08, Season 3 Episode 00, Season 3 - 12,
S02 Ep08, anime `(S02) ... - 08`, and an unqualified `Title - 05` interpreted as S1E5.
Movie years and resolution/codec numbers are not treated as episode numbers.
Season must be an integer >= 1; Episode must be an integer >= 0. Empty, fractional,
negative, unsafe, or nonnumeric values are invalid. E0 and padded E00 are valid.

Work is the conservative default when no episode pattern is detected. A Series or
Anime category alone does not identify an episode. A mode tooltip explains whether
the mode was detected or saved manually. Changing Work/Episode updates all rows
with the same exact nonempty Note path, preserves edited numbers, fills missing
numbers from each filename, defaults only missing seasons to 1, and leaves unknown
episodes blank. Preferences persist as per-note `noteModes`.

Manual note selection selects the row, saves the source-title mapping, and applies
it to similar source-title rows without replacing their individual episode numbers.
Scores are attached to individual suggestions; a manually chosen note does not
inherit the confidence of a previous automatic candidate.

## Conversion and Preview

Supported output formats are WebP, JPEG, PNG, and original. WebP uses cwebp; JPEG
and PNG use the bundled minimal FFmpeg. Original copies without encoding.
WebP Quality is 1-100. WebP Effort is 0-6 (`cwebp -m`): encoding effort, not visual
quality. Higher effort can reduce size at the cost of processing time. No resizing
is performed. Conversion preserves the base filename and changes its extension.

Quality Defaults in Settings stores a fallback and category values. Anime starts
at 50; the other categories start at 90. Per-note overrides take precedence and
apply to every row sharing the Note. Output settings are captured for each import.

Preview has a thumbnail file list with total count/size, stacked original/converted
images, central detail crops, output size, and isolated temporary encoder settings.
Clicking an image opens a separate native image window. Apply Quality propagates
the chosen quality to the note group and closes the dialog. Suggested quality is
the knee of a tested file-size curve, not a perceptual-quality guarantee; visual
inspection remains necessary. Preview files are temporary and never enter history.

Parallel Images supports Auto/1/2/3/4. Bounded workers encode scratch files while
note edits, output publication, conflict resolution, and journaling remain serial.
Copy mode stays sequential. Encoder failures remove scratch output and preserve
existing attachments. Conflict policies remain increment, reuse, skip, overwrite;
overwrite backs up the prior attachment before publication.

## Markdown Insertion

Work mode appends to an existing screenshots section without erasing text. The
original localized screenshots heading remains supported for existing notes.
Episode mode searches heading prefixes in any level, including padded and
commented headings such as `#### S2E09 A comment`. Existing headings are reused.
Screenshots are added after existing episode text, before the next peer section.

Missing seasons receive `Season N`, matching another season's level when available
and otherwise H3. Episode headings use the established section hierarchy. Selected
imports are ordered by note, season, and episode; display sorting does not change
numeric insertion order. Duplicate Note/S/E targets require confirmation and share
one heading while retaining independent source blocks and journals.

Each insertion is marked for scoped rollback:

```md
<!-- iina-screenshot-importer:start run=RUN_ID source="SOURCE_FOLDER" -->
![[Images/Note Name/image.webp]]
<!-- iina-screenshot-importer:end run=RUN_ID -->
```

This historical marker identifier is a compatibility contract, not a source-player
requirement. Changing it would prevent old rollback journals from finding blocks.

Markdown writes are atomic. The native preserve-creation-time helper copies and
verifies the original nanosecond macOS birthtime before replacement; modification
time advances. Permissions and concurrent-edit checks are retained. Any metadata
preservation failure leaves the original note unchanged. Old lost creation dates
cannot be reconstructed and must not be guessed.

## Archives and Rollback

After a folder succeeds, originals move to `_archive/<run-id>/<folder-name>`.
Run journals are written atomically to `runs/<run-id>.json`. Note and overwritten
attachment backups are stored under `backups/<run-id>`. Originals are not deleted
automatically and must remain available until the imported result is verified.

Full-run and per-folder rollback share the same implementation. Source return
paths and archive availability are checked before note mutation. Rollback removes
only that source's marked Markdown block, preserves subsequent note edits and
other imports, removes unchanged generated images that are no longer referenced,
restores backed-up overwritten attachments, and returns originals. Changed or
still-referenced output files are retained. SHA-256 checks protect newer journals;
older journals cannot gain hashes or attachment backups retroactively.

Per-item checkpoints allow explicit retries after interruption. Already rolled-back
or trashed folders are skipped. Empty created headings may remain. Empty archive
run directories are removed. Full-note backups remain available for manual recovery.

Rollback jobs expose phase, monotonic processed steps, current item, ETA, result,
and errors. Reference indexing precedes counted steps. Completion percentage means
processed, not successful; Partial reports failures independently. Progress polling
continues through tab changes, refreshes, and transient network errors. The active
job is discoverable after interface reload, but jobs do not resume automatically
after backend termination. Malformed item requests must never become run rollback.

An exclusive lock blocks overlapping imports, rollback, archive Trash, and update
downloads. Native shutdown waits for ongoing mutations and writes. Archive cleanup
moves sources into the stock macOS Trash without Finder automation or permanent
deletion. Restoring from Trash is possible until the Trash is emptied.

## Interface Contracts

- Screenshots: Folder, separate sortable Size, searchable Note, Quality, Mode, S/E,
  Use selection, preview, Finder folder link, and Obsidian note link. File counts
  use thousands separators; dates use 24-hour time. Work S/E fields are disabled
  and empty. New scans do not silently select everything.
- Selection: Shift selects a visible sorted range; double-click Use selects or
  clears every folder with the same exact Note based on the initial checkbox state.
  Unmatched rows are never grouped. Sorting cycles ascending/descending/reset.
- History: latest 50 journals, collapsed runs with indented folder rows, dates,
  counts, size reduction, note/archive links, per-folder and whole-run actions.
  Uniform child status propagates to the run. Done permits eligible actions;
  Rollbacked removes Trash; Trashed removes Rollback. Terminal buttons show dates
  in tooltips. Missing originals make rollback unavailable without blocking other
  eligible folders in the same run.
- Results: import and rollback completion dialogs include totals, per-folder
  outcomes, and errors. Size pairs use an arrow and reduction in parentheses.
- Settings: Appearance, Output, Quality Defaults, Locations, and Update. Theme is
  System/Light/Dark, follows OS changes when System is selected, and persists.
- Navigation: each section retains independent scroll state for the window session;
  double-clicking its tab goes to the top. Late renders must not undo later scrolls.
- Layout: centered width-constrained desktop surface; compact narrow rows without
  horizontal overflow. Service/progress, section, and table headers remain sticky
  without transparent gaps. Navigation and process actions occupy separate rows.

## Desktop Architecture

`macos/DesktopApp.swift` owns the AppKit/WKWebView window and the bundled Node child.
`src/desktop.mjs` provides a private JSON pipe protocol, local data locking, a
random loopback port, and graceful shutdown. `src/server.mjs` is an imported server
factory, not a standalone public launch command. The old shell launcher, Homebrew
setup script, and browser-production entrypoint are removed.

Native script messages are accepted only from the loopback main frame. The HTTP
server rejects cross-origin/nonlocal requests and non-JSON mutation requests.
Folder and image links use validated existing paths. Preview windows do not quit
the application; closing the main window or Cmd+Q does. Pending settings writes
are flushed before shutdown. No developer tools are needed on the destination Mac.

## GitHub Updates

Update checks are manual through Settings > Update or Check for Updates in the app
menu. No launch-time network check, telemetry, user credentials, source-image
upload, or vault-data transmission is performed. Local work remains usable offline.

`src/updates.mjs` queries the fixed public repository's GitHub Releases API, bounded
by time, response size, and pagination. Drafts/prereleases are excluded. Numeric
versions are ordered semantically. The dialog renders release bodies as text, never
HTML or executable remote content. Older app versions cannot be installed.

A compatible asset must have the exact versioned Apple Silicon ZIP name, canonical
repository URL, bounded byte length, and a SHA-256 digest. Downloads stream to a
private local directory and allow only HTTPS GitHub release/CDN redirects. Incomplete
or mismatched files are deleted. No URL supplied by the interface is downloaded.

Install and Restart reserves backend shutdown, rechecks the digest, inspects ZIP
paths, rejects symlinks, validates version/bundle identifier/arm64/signature, and
stages the new bundle beside the old one. The signed native UpdateInstaller waits
for graceful host exit before replacing files. Replacement/open failures restore
the previous bundle. A startup marker confirms the new backend before the retained
old bundle is removed; a startup timeout retains the previous app and records its
location in update.log. User state is never replaced.

The app is ad-hoc signed, not Developer ID signed/notarized. HTTPS and GitHub's digest
protect transfer integrity, but do not provide a separately signed publisher feed.
The repository account and GitHub infrastructure remain part of the trust model.
Installation requires writable local storage; no privilege escalation, Gatekeeper
disabling, or remote-code evaluation is used. Translocated/read-only/external-volume
copies require a manual move to a local Applications folder.

## Build and Verification

The repeatable Apple Silicon build pins Node.js, WebP, and minimal LGPL FFmpeg,
compiles native helpers, checks dynamic dependencies, signs outside synchronized
storage, and creates versioned ZIPs. Matching codec sources, third-party notices,
and English project sources accompany each release. Generated builds, personal
data, local instructions, and release archives are excluded from Git.

Tests use disposable source/vault/history fixtures only. Native WKWebView checks
are required for modal layout, previews, and update integration. Changes must retain
creation dates, category boundaries, reference checks, atomic writes, rollback
journals, and graceful shutdown. Builds must work from arbitrary clone locations.
Release/version/build details are maintained in PORTABLE-APP.md and CHANGELOG.md.
