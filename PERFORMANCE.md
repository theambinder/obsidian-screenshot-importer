# Size and Conversion: 1.1.0

## Installed Size

The 1.0.0 app's file contents totalled 143,532,891 bytes (Finder may report approximately 145 MB including filesystem overhead). Most of it was the complete standalone Node.js binary: 122,129,232 bytes. The native host and application code were under 1 MB; WebP and FFmpeg together were about 5 MB.

Changes in 1.1.0:

- Run `strip -S -x` on the bundled Node executable before re-signing. Removes about 24 MB of debug/local symbol information without changing runtime code, exported symbols, full ICU data, or encoder behavior.
- Move roughly 15 MB of third-party source archives and rebuild materials into a separate companion archive. It still ships inside the main distribution ZIP, but does not occupy space inside the installed `.app`. Licenses remain in the app. This moves source material out of the installation; it does not eliminate those bytes from the complete source-inclusive download.
- Keep the same Node, cwebp, and FFmpeg versions. No dependency download/extraction is deferred until launch, and no system package is required.

The remaining size is mostly the JavaScript runtime. A substantially smaller native backend would require a separate rewrite and new equivalence tests; dropping portability or hiding the runtime in a cache would not be a like-for-like reduction.

The rebuilt 1.1.0 `.app` totals approximately **103.4 MB** of file contents, about **28% smaller**. The complete distribution ZIP remains approximately **53.4 MB** because it also includes the companion source archive. MB here means decimal megabytes; filesystem tools reporting MiB will show lower numbers.

## Conversion Benchmark

Measured on this Apple Silicon Mac (14 available CPU cores, 48 GiB memory), two runs per mode. Twelve original screenshots were copied into a disposable local test vault: six 1920x1080 anime frames at WebP Q50, and six 3840x2160 live-action frames at WebP Q90. Effort remained 6; no resize or new image processing was applied.

Timing covers the full import into the test vault, including conversion, hashing, journaling, note insertion, and archive moves. Initial fixture copying and iCloud download/sync latency are excluded. These are measurements on this Mac and these files, not a universal performance guarantee.

| Mode | Run 1 | Run 2 | Average |
| --- | ---: | ---: | ---: |
| 1.0.0 sequential | 5.059 s | 5.014 s | 5.037 s |
| 1.1.0 / 1 image | 5.058 s | 5.013 s | 5.036 s |
| 1.1.0 / 2 images | 2.772 s | 2.789 s | 2.781 s |
| 1.1.0 / 4 images | 1.963 s | 1.963 s | 1.963 s |

Four-image concurrency was about **2.57x faster**, two-image concurrency about **1.81x faster**. Every mode produced exactly 2,591,292 output bytes. SHA-256 matched for every output image across all modes; source hashes before and after the benchmark also matched. User notes, source folders, and history were not changed.

Higher concurrency uses more CPU and memory; Auto uses fewer workers on smaller Macs. A single-image preview is not made faster by this batch optimization. WebP Effort is deliberately unchanged: lowering it is a separate speed/compression-size tradeoff, not the mechanism behind these results.

## Safety and Reproduction

Only image encoding is parallel. A bounded batch is fully drained before ordered publication; failures and early exits clean scratch files. `increment`, `reuse`, `skip`, and `overwrite` resolve their names at serial commit time, including duplicate basenames such as `a.jpg` and `a.png`. Original/copy mode avoids staging overhead. Completed mutations retain the existing checkpoints, backups, hashes, sorted episode insertion, and rollback behavior.

`tests/performance.test.mjs` compares sequential/parallel bytes, link order, conflicts, rollback, encoder failures, and cleanup. `tests/desktop.test.mjs` exercises packaged encoders and shutdown during import. `scripts/benchmark-conversion.mjs` records local measurements in `build/conversion-benchmark.json`; it expects the previous app's `Resources/app` snapshot at `build/performance-baseline` and the explicitly supplied Screenshots root. Sample folder selectors inside that developer-only script describe this measurement and can be adapted for later benchmarks. Never point its temporary vault at real user notes.
