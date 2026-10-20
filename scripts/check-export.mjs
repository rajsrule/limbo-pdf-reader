import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFString, PDFHexString } from "pdf-lib";
import assert from "node:assert/strict";
const bytes = await readFile("test-results/annotated.pdf"),
  original = await readFile("tests/fixtures/Reading sample.pdf");
assert.ok(
  bytes.subarray(0, original.length).equals(original),
  "Export must preserve original PDF bytes and append annotations",
);
const doc = await PDFDocument.load(bytes);
const annots = doc.getPage(0).node.Annots();
assert.ok(annots);
let highlight = false,
  comment = false;
for (let i = 0; i < annots.size(); i++) {
  const a = doc.context.lookup(annots.get(i));
  const subtype = a.get(PDFName.of("Subtype"))?.toString();
  if (subtype === "/Highlight") {
    highlight = true;
    const text = a.get(PDFName.of("Contents"));
    if (text instanceof PDFString || text instanceof PDFHexString)
      comment ||= text.decodeText().includes("A note that travels");
  }
}
assert.ok(highlight, "A standard Highlight annotation must be present");
assert.ok(comment, "The attached comment must be serialized as PDF Contents");
console.log(
  "Independent PDF parser verified the standard highlight, attached comment, and byte-for-byte preservation of original document content.",
);
