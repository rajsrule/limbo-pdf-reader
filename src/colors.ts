import { OPS, type PDFPageProxy } from "./vendor/pdf.mjs";
export interface Classification {
  dark: boolean;
  reason: string;
  thumbnail: string;
}
// Conservative: a page with advanced compositing retains its original colors.
export async function classifyPage(
  page: PDFPageProxy,
  render = page.render.bind(page),
): Promise<Classification> {
  const viewport = page.getViewport({
    scale: 150 / page.getViewport({ scale: 1 }).width,
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await render({ canvas, canvasContext: ctx, viewport, annotationMode: 0 })
    .promise;
  const thumbnail = canvas.toDataURL("image/webp", 0.65);
  const [list, text] = await Promise.all([
    page.getOperatorList({ annotationMode: 0 }),
    page.getTextContent(),
  ]);
  let complex = false,
    image = false;
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i];
    if (
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectGroup,
        OPS.paintImageMaskXObjectRepeat,
      ].includes(op)
    )
      image = true;
    if (
      [
        OPS.shadingFill,
        OPS.setFillColorN,
        OPS.setStrokeColorN,
        OPS.beginGroup,
      ].includes(op)
    )
      complex = true;
    if (op === OPS.setGState)
      for (const [k, v] of list.argsArray[i][0])
        if (
          (k === "BM" && v !== "source-over" && v !== "Normal") ||
          (k === "SMask" && v) ||
          ((k === "ca" || k === "CA") && v < 1) ||
          k === "TR"
        )
          complex = true;
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let neutral = 0,
    light = 0,
    dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) continue;
    neutral++;
    const l = (r + g + b) / 3;
    if (l > 190) light++;
    if (l < 65) dark++;
  }
  const scanned = image && text.items.length < 8;
  const reason = complex
    ? "Original colors · complex artwork"
    : scanned
      ? "Original colors · scanned page"
      : dark > light
        ? "Already dark · original colors"
        : light / Math.max(neutral, 1) < 0.55
          ? "Original colors · mixed background"
          : "Smart Dark · colors preserved";
  canvas.width = canvas.height = 0;
  return {
    dark:
      !complex &&
      !scanned &&
      light / Math.max(neutral, 1) >= 0.55 &&
      light > dark,
    reason,
    thumbnail,
  };
}
