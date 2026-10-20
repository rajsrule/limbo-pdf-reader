// Deliberately fail closed when the pinned upstream renderer changes.
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const upstream = new URL("node_modules/pdfjs-dist/", root);
const vendor = new URL("src/vendor/", root);
const assets = new URL("public/pdfjs/", root);
await mkdir(vendor, { recursive: true });
await mkdir(assets, { recursive: true });
let pdf = await readFile(new URL("legacy/build/pdf.mjs", upstream), "utf8");
function replaceOnce(before, after) {
  if (pdf.split(before).length !== 2)
    throw new Error(`PDF.js patch drift: ${before.slice(0, 70)}`);
  pdf = pdf.replace(before, after);
}
const color = await readFile(new URL("src/neutral-color.js", root), "utf8");
pdf = color.replace("export function", "function") + "\n" + pdf;
replaceOnce(
  "    this.ctx = canvasCtx;\n    this.current = new CanvasExtraState",
  "    this.ctx = canvasCtx;\n    this.limboDark = !!canvasCtx.canvas.__limboDark;\n    this.current = new CanvasExtraState",
);
replaceOnce(
  '    this.ctx.fillStyle = background || "#ffffff";',
  '    this.ctx.fillStyle = this.limboDark ? limboNeutralColor(background || "#ffffff") : background || "#ffffff";',
);
replaceOnce(
  "    resetCtxToDefault(this.ctx);\n    if (transform)",
  '    resetCtxToDefault(this.ctx);\n    if (this.limboDark) {\n      this.ctx.fillStyle = this.ctx.strokeStyle = this.current.fillColor = this.current.strokeColor = "#eeeeee";\n    }\n    if (transform)',
);
for (const method of ["setFillRGBColor", "setStrokeRGBColor"]) {
  const marker = `  ${method}(opIdx, color) {`;
  replaceOnce(
    marker,
    marker + "\n    if (this.limboDark) color = limboNeutralColor(color);",
  );
}
// A selected highlight can be deleted while its asynchronous color toolbar is
// loading. Upstream otherwise dereferences a toolbar already removed by Delete.
replaceOnce(
  "        await this._editToolbar.addButton(name, tool);",
  "        const limboToolbar = this._editToolbar;\n        await limboToolbar.addButton(name, tool);\n        if (this._editToolbar !== limboToolbar) return null;",
);
await writeFile(
  new URL("pdf.mjs", vendor),
  pdf.replace(/\/\/# sourceMappingURL=.*$/gm, ""),
);
await writeFile(new URL("pdf.d.mts", vendor), 'export * from "pdfjs-dist";\n');
let viewer = await readFile(
  new URL("legacy/web/pdf_viewer.mjs", upstream),
  "utf8",
);
viewer =
  'import * as pdfjsLib from "./pdf.mjs";\n' +
  viewer.replace("} = globalThis.pdfjsLib;", "} = pdfjsLib;");
viewer = viewer.replace(
  "const DEFAULT_CACHE_SIZE = 10;",
  "const DEFAULT_CACHE_SIZE = 3;",
);
viewer = viewer.replace(/\/\/# sourceMappingURL=.*$/gm, "");
pdf = pdf.replace(/\/\/# sourceMappingURL=.*$/gm, "");
await writeFile(new URL("pdf_viewer.mjs", vendor), viewer);
await writeFile(
  new URL("pdf_viewer.d.mts", vendor),
  'export * from "pdfjs-dist/types/web/pdf_viewer.component";\n',
);
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(new URL(dir, upstream), new URL(dir, assets), { recursive: true });
await cp(new URL("web/images", upstream), new URL("images", assets), {
  recursive: true,
});
await cp(
  new URL("legacy/build/pdf.worker.mjs", upstream),
  new URL("pdf.worker.mjs", assets),
);
console.log(
  "Prepared pinned PDF.js with isolated neutral-color drawing hooks and local assets.",
);
