import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
await mkdir("tests/fixtures", { recursive: true });
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica),
  bold = await doc.embedFont(StandardFonts.HelveticaBold),
  serif = await doc.embedFont(StandardFonts.TimesRoman);
function page(title, background = rgb(1, 1, 1), foreground = rgb(0, 0, 0)) {
  const p = doc.addPage([612, 792]);
  p.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: background });
  p.drawText(title, { x: 54, y: 725, size: 25, font: bold, color: foreground });
  return p;
}
const p1 = page("A quieter place to read");
p1.drawText("LIMBO READER / FIELD NOTES", {
  x: 54,
  y: 680,
  size: 10,
  font,
  color: rgb(0.3, 0.25, 0.4),
});
const lines = [
  "PDFs should feel comfortable, even after midnight.",
  "Smart Dark changes neutral paper and ink while preserving",
  "the colors that tell the rest of the story.",
  "",
  "Select this passage to highlight it and attach a comment.",
  "Your original document remains untouched.",
];
lines.forEach((text, i) =>
  p1.drawText(text, {
    x: 54,
    y: 625 - i * 25,
    size: 15,
    font,
    color: rgb(0.08, 0.08, 0.08),
  }),
);
p1.drawText("Blue stays blue.", {
  x: 54,
  y: 390,
  size: 21,
  font: bold,
  color: rgb(0.1, 0.4, 0.9),
});
p1.drawRectangle({
  x: 54,
  y: 280,
  width: 150,
  height: 60,
  color: rgb(0.1, 0.4, 0.9),
});
p1.drawRectangle({
  x: 230,
  y: 280,
  width: 150,
  height: 60,
  color: rgb(0.8, 0.2, 0.3),
});
p1.drawText("A small diagram, with its original colors.", {
  x: 54,
  y: 250,
  size: 12,
  font: serif,
  color: rgb(0.2, 0.2, 0.2),
});
// A tiny original raster scene containing both neutral and colored pixels.
const w = 160,
  h = 100,
  pixels = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    let c = y < 55 ? [65 + x / 5, 108 + y, 178 + y / 2] : [45, 82 + x / 5, 60];
    if ((x - 120) ** 2 + (y - 23) ** 2 < 150) c = [248, 218, 144];
    if (x < 50 && y > 40) c = [235, 235, 235];
    pixels.set(c.map(Math.round), i);
  }
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const kind = Buffer.from(name),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, crc]);
}
function png(width, height, rgbBytes) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const scan = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    rgbBytes.copy(
      scan,
      y * (width * 3 + 1) + 1,
      y * width * 3,
      (y + 1) * width * 3,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scan)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const photo = await doc.embedPng(png(w, h, pixels));
p1.drawImage(photo, { x: 410, y: 275, width: 148, height: 92 });
p1.drawText("Embedded image", {
  x: 410,
  y: 250,
  size: 10,
  font,
  color: rgb(0.2, 0.2, 0.2),
});
const p2 = page(
  "Already dark. Still dark.",
  rgb(0.025, 0.025, 0.025),
  rgb(0.94, 0.94, 0.94),
);
p2.drawText("This page should not be inverted by Smart Dark.", {
  x: 54,
  y: 650,
  size: 17,
  font,
  color: rgb(0.9, 0.9, 0.9),
});
p2.drawText("A blue accent stays blue here, too.", {
  x: 54,
  y: 600,
  size: 17,
  font,
  color: rgb(0.1, 0.4, 0.9),
});
const scan = page("");
scan.drawImage(photo, { x: 0, y: 0, width: 612, height: 792 });
const complex = page("Transparency and artwork");
complex.drawRectangle({
  x: 54,
  y: 400,
  width: 300,
  height: 180,
  color: rgb(0.4, 0.2, 0.7),
  opacity: 0.45,
});
complex.drawText("Preserve original colors for complex compositing.", {
  x: 54,
  y: 650,
  size: 15,
  font,
});
const rotated = page("Rotated page");
rotated.setRotation({ type: "degrees", angle: 90 });
rotated.drawText("Text selection and highlights should stay aligned.", {
  x: 54,
  y: 650,
  size: 15,
  font,
});
// Embedded chapter destinations exercise the actual outline sidebar.
const outlines = doc.context.obj({ Type: "Outlines", Count: 3 });
const outlinesRef = doc.context.register(outlines);
let prev;
for (const [index, title] of [
  [0, "A quieter place"],
  [1, "Already dark"],
  [4, "A different angle"],
]) {
  const node = doc.context.obj({
    Title: PDFString.of(title),
    Parent: outlinesRef,
    Dest: [doc.getPage(index).ref, PDFName.of("Fit")],
  });
  const ref = doc.context.register(node);
  if (prev) {
    prev.node.set(PDFName.of("Next"), ref);
    node.set(PDFName.of("Prev"), prev.ref);
  } else outlines.set(PDFName.of("First"), ref);
  prev = { node, ref };
}
outlines.set(PDFName.of("Last"), prev.ref);
doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
await writeFile("tests/fixtures/Reading sample.pdf", await doc.save());
const second = await PDFDocument.create();
const sf = await second.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 3; n++) {
  const p = second.addPage([612, 792]);
  p.drawText("On the other side", { x: 54, y: 725, size: 28, font: sf });
  p.drawText(`Compare two documents in Limbo. Page ${n}`, {
    x: 54,
    y: 650,
    size: 16,
    font: sf,
  });
}
await writeFile("tests/fixtures/Companion notes.pdf", await second.save());
const large = await PDFDocument.create();
const lf = await large.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 600; n++) {
  const p = large.addPage([612, 792]);
  p.drawText(`Large document / page ${n}`, {
    x: 54,
    y: 725,
    size: 22,
    font: lf,
  });
  for (let line = 0; line < 25; line++)
    p.drawText(`A readable line on page ${n}, line ${line + 1}.`, {
      x: 54,
      y: 650 - line * 21,
      size: 12,
      font: lf,
    });
}
await writeFile("tests/fixtures/Large document.pdf", await large.save());
console.log(
  "Generated digital, dark, scanned, transparent, rotated, outlined, and 600-page fixtures.",
);
