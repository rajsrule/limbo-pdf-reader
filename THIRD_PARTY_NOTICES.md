# Third-party notices

Limbo's original code is MIT licensed. Dependency licenses remain applicable.

- PDF.js / pdfjs-dist © Mozilla Foundation and contributors: Apache License 2.0. The compatibility build receives deterministic neutral-color hooks and a guard against deleting an asynchronously loading annotation toolbar, documented in scripts/prepare-pdf.mjs. The viewer page cache is reduced. Its full license is shipped in licenses/PDFjs-LICENSE.txt. PDF.js includes separately licensed fonts, CMaps, and WASM components; their upstream notice files are preserved in the bundled assets.
- React / React DOM © Meta Platforms, Inc. and affiliates: MIT.
- Tauri and its plugins © Tauri Programme within The Commons Conservancy and contributors: MIT OR Apache-2.0.
- Rust dependencies retain the licenses recorded in Cargo.lock and their source packages. Build-time tooling is not part of the application runtime.
- Microsoft Edge WebView2 is a Microsoft system runtime, distributed and serviced by Microsoft under its own terms. Limbo uses the installed Evergreen runtime; the installer can obtain it from Microsoft when missing.

The repository includes a generated dependency-license inventory and full runtime license texts in notices/. The application uses original vector artwork and the system's installed fonts. No Geometry Dash artwork, music, or assets are distributed.
