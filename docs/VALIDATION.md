# Validation — Limbo 0.1.2

Validated on Windows 11 x64 using Node 24.19.0, Rust 1.99.1/MSVC, PDF.js 6.4.299 (compatibility build), and Chromium 141 for browser automation.

## Passed

- Production frontend build and native Windows release compilation.
- Six unit tests: four color-mapping tests, nested/named outline destination resolution with page labels and caching, and malformed/out-of-range outline handling.
- Nine end-to-end tests: the original seven reading, colors, split, recovery/export and large-document tests, plus black surfaces/numbered chapters/held original preview, and actual mouse selection, floating highlight actions, selection survival across autosave ticks, color-picker visibility/size, and unobstructed comment dialogs.
- Five Rust tests: record/path validation, atomic replacement of saved records, cancellation/ownership preservation when an unready transfer destination closes, continued source reads during a window handoff, and application navigation restricted to bundled origins.
- Independent pdf-lib parsing confirms a standard Highlight annotation and comment Contents, with the source PDF bytes preserved exactly before the incremental annotation update.
- The actual release executable was opened and visually inspected on Windows. Opening a generated PDF through a second process correctly reached the running desktop reader and rendered Smart Dark.
- Per-user NSIS installation completed successfully, installed the executable, license notices, uninstaller, and Start menu shortcut, registered Limbo in Open with, and preserved both the fallback file association and Windows UserChoice. The test uninstaller removed its executable and preserved the draft folder. Explicit NSIS registration hooks avoid Tauri's default-handler association macro.
- Earlier same-version and 0.1.0-to-0.1.1 upgrades preserved both PDF defaults. Installed binaries matched their release builds byte for byte after accounting for Tauri's expected three-byte NSIS bundle marker.
- The 0.1.2 upgrade passed with existing draft files preserved, PDF defaults unchanged, Open with/Start menu entries present, and the installed executable matching the final release build after the same bundle-marker normalization.
- npm dependency audit: zero known vulnerabilities after updating Vitest to 4.1.12.

## Performance observations

- Initial installer: approximately 3.9 MiB; the final downloadable artifact has its own SHA-256 checksum.
- A local UI check on the user's 729-page screenshot document created a highlight in approximately 66–86 ms and displayed 356 numbered chapter entries, without page errors. This measures Chromium UI interaction after document initialization; it does not benchmark native draft saves or cold startup. The private document and its screenshots are not included in the repository.
- Across repeated automated runs, the local generated 600-page PDF reached its first page in approximately 0.5–1.2 seconds including the automated file-choice step. Jumping to page 599 left three live page canvases. This measures the frontend reader after browser startup, not cold native or WebView2 startup.
- An earlier interactive desktop preview had approximately 530 MiB of summed process working sets across Limbo and six WebView2 child processes. Shared pages are counted repeatedly by this metric. This is not private memory, and the final executable was not separately memory-profiled. A small installer does not imply a tiny WebView2 memory footprint.

## Manual validation still needed

Native GUI testing was stopped when the user pressed Escape; no further desktop input was automated. Final-build separate-window transfers, the native maximize-hover Snap Layouts picker, mixed-DPI/multi-monitor snapping, physical printing, and annotated export in another interactive PDF reader still need manual checks. The underlying transfer cancellation path has Rust coverage; the annotation file format has an independent parser check.

Password prompting and cancellation, non-Latin/embedded-font documents, damaged third-party PDFs, and broad real-world PDF compatibility need a larger document corpus. Generated fixtures are intentionally small, original examples, not a comprehensive compatibility suite.

## Known design limits

Smart Dark intentionally preserves scanned pages and advanced blending/pattern artwork. Full Invert is available for monochrome scans and also inverts images. Local drafts are full annotated-PDF checkpoints; large documents can consume significant disk space. Browser-preview draft storage has browser quotas; the installed app uses local files and binary IPC for draft writes.

The first release is unsigned. Insertable note pages, OCR, cloud sync, PDF text editing, paid signing, and automatic updates are deferred.
