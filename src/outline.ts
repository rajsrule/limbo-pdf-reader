import type { PDFDocumentProxy } from "./vendor/pdf.mjs";
import type { OutlineItem } from "./types";

export type ChapterPage = { page: number; label: string };
export const destinationKey = (dest: OutlineItem["dest"]) =>
  JSON.stringify(dest);

// Resolve only outline destinations, never walk every page of a large book.
export async function resolveChapterPages(
  doc: PDFDocumentProxy,
  outline: OutlineItem[],
  cache: Map<string, ChapterPage>,
  publish: () => void,
  cancelled: () => boolean,
) {
  const labels = await doc.getPageLabels();
  const pending = [...outline];
  let batch = 0;
  while (pending.length && !cancelled()) {
    const item = pending.shift()!;
    pending.unshift(...(item.items || []));
    const key = destinationKey(item.dest);
    if (!item.dest || cache.has(key)) continue;
    try {
      const dest =
        typeof item.dest === "string"
          ? await doc.getDestination(item.dest)
          : item.dest;
      if (!dest?.length) continue;
      const first = dest[0];
      const index =
        typeof first === "number"
          ? first
          : await doc.getPageIndex(first as any);
      if (cancelled()) return;
      if (Number.isInteger(index) && index >= 0 && index < doc.numPages)
        cache.set(key, {
          page: index + 1,
          label: labels?.[index] || String(index + 1),
        });
    } catch {
      // Keep malformed destinations by title without inventing a page number.
    }
    if (++batch % 16 === 0) {
      publish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (!cancelled()) publish();
}
