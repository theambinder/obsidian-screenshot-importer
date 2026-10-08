# Code Audit: 2026-09-18

Follow-up: the portable native macOS app has since been implemented and tested; see [PORTABLE-APP.md](PORTABLE-APP.md). Its lifecycle, local data lock, and 35-test verification supersede the legacy launcher's limitations below. The original audit findings remain documented here.

Scope: import, conversion and preview, rollback, archive/history, matching, settings, HTTP API, and the macOS launcher. Changes were tested using disposable temporary fixtures; the user's notes, screenshots, archive and saved settings were not changed.

## Fixed Findings

| Priority | Finding | Result |
| --- | --- | --- |
| P1 | Full-run rollback restored whole note backups, overwriting later edits and imports. | Both rollback modes now remove only the selected import's marker blocks. Repeated rollback is idempotent, completed steps are recorded, and partial rollback remains retryable. |
| P1 | Overwrite conversion replaced existing attachments without recovery copies; rollback deleted them. | New imports back up replaced attachments and restore their bytes on rollback. Encoders publish output by a temporary file and rename. Failed conversion keeps the previous output. |
| P1 | Rollback could delete attachments edited or reused after import. | New imports record SHA-256. Changed files cause a partial result and are kept. Non-overwritten attachments still referenced by allowed Media notes are retained. Reference checks are conservative basename checks. |
| P1 | Rollback could mutate notes before discovering a missing archive, or report success while a conflicting original folder left the archive untouched. | Source existence and conflicts are checked before changing that folder's note. Errors leave an actionable partial status. |
| P1 | A second browser request could import, roll back or trash the same data concurrently. | The server rejects overlapping import/rollback/archive mutations with HTTP 409. This guard covers one server process, not multiple Macs. |
| P1 | Write endpoints trusted paths too broadly and accepted foreign-origin requests. | Note writes enforce the category allowlist and `.md`; source names and run IDs are validated; key read/write paths check symlink containment. Foreign-origin or non-local Host requests are rejected, POST requires JSON, and request bodies are capped at 1 MiB. |
| P2 | Converted preview links used `data:` URLs and opened blank tabs. | Preview JSON now returns a normal `/api/preview-image/<id>` URL. Full image and crop links open the same actual converted image in separate tabs. |
| P2 | Stale preview conversions and ten-step quality searches continued after switching images/closing the dialog. | Client requests and encoder processes are cancelled. Responses from earlier folder selections are ignored. Temporary encoder files are cleaned in `finally`. |
| P2 | Runs with failed folders were shown as successful; errors could leave buttons disabled or show stack traces. | Jobs persist `done`, `partial` or `error`; the result dialog and History expose failures. Polling no longer overlaps. UI errors show messages and release busy state. |
| P2 | Journals/settings were written directly, risking truncated JSON; mapping updates could overwrite each other. | JSON and note writes use temporary files plus rename. Imports checkpoint their recoverable operations. Rule updates and client settings saves are serialized. |
| P2 | Expanding a Run fetched and rescanned History; archive statistics traversed the same directories multiple times. | Expand/collapse is local. History calculates details only for the requested latest runs and shares one statistics cache within the request. Overall archive totals still require one traversal. |
| P2 | Fenced Markdown examples and frontmatter could be mistaken for episode headings. | Heading detection skips both. Rollback no longer normalizes blank lines elsewhere in the note. |
| P2 | Equally strong title matches silently picked the alphabetically first category. | Candidates within 5 percentage points require manual selection. Explicit saved mappings still have priority. |
| P2 | Import could archive a source folder whose file list changed during conversion. | It checks names, sizes and modification times again before note insertion and leaves changed sources for a retry. This is detection, not a filesystem lock. |
| P3 | Result totals counted episodes as separate works. | Works are counted by distinct note path; processed screenshots use the output file count. |

## Preview Lifetime

The in-memory preview cache keeps at most 32 images / 128 MiB for up to one hour. It is cleared when the service stops; older entries can be evicted earlier to meet the limits. An expired link returns a readable message. Reopen/regenerate the preview to obtain a new link. Converted previews no longer travel in JSON as base64.

## Compatibility And Remaining Work

- Old run logs remain readable, but cannot retroactively acquire hashes or overwrite backups. Backups of entire notes remain available for manual recovery. Newly created empty headings are deliberately not removed by rollback.
- iCloud is not a transaction coordinator. Use one Mac/server at a time and let synchronization finish before switching machines. Atomic local renames and the server guard cannot prevent concurrent remote edits. A very small window also remains between a local change check and rename.
- Frontmatter parsing in `src/mediaIndex.mjs` supports a limited YAML subset; inline alias arrays and multiline scalars need a real YAML parser. Matching remains heuristic, and saved rules are keyed by normalized title rather than release year/category. Review suggestions, especially remakes and adaptations with the same title.
- `Output`, fallback quality and per-note quality overrides still reset with the browser session. Category defaults persist in `data/settings.json`. Persisting the complete settings model is a separate migration.
- `Auto Quality` optimizes the measured size curve, not perceptual image quality. It does not guarantee invisible losses, particularly for detailed live-action frames.
- History still reads all small JSON logs to sort them and totals the whole archive once per Refresh. The latest-50 UI has no pagination. An index/pagination is the next step if this becomes slow at a large scale.
- Attachment reference protection scans only the allowed Media categories and uses conservative filename matching; it is not a full Obsidian backlink index for the entire vault.
- The macOS launcher is still a shell/controller wrapper and was inspected, not rebuilt or installed during this audit. Shutdown during processing can leave an interrupted run for manual inspection/rollback; there is no automatic resume. JSON checkpoints improve recovery but are not an fsync-backed transactional database.
- Native Trash operations were reviewed but not exercised against the user's actual archive or macOS Trash. No real user files were moved or deleted during validation.

## Verification

- `npm test`: regression suite includes real WebP conversion/HTTP retrieval, overlapping mutation rejection, origin checks, later-edit preservation, overwrite restoration, partial rollback retries, mixed trashed/rollback runs, missing/conflicting sources, symlink/category restrictions, concurrent rule saves, fenced headings and ambiguous matching.
- `node tests/preview-server.mjs`: disposable browser fixture using a generated 1280x720 image. Clicked both converted links and confirmed separate image tabs. Stop with Ctrl+C; the fixture removes its temporary data.
- Tests requiring HTTP listeners need localhost permission in a sandbox. Image integration tests require the existing `cwebp` and `ffmpeg`; they explicitly skip when these tools are unavailable.

To use the changes, stop and reopen the normal macOS app so the backend and frontend are both refreshed.
