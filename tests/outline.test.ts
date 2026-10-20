import { expect, it, vi } from "vitest";
import { resolveChapterPages } from "../src/outline";

it("resolves nested and named chapters to PDF page labels without reading page contents", async () => {
  const getPageIndex = vi.fn(async () => 4);
  const getDestination = vi.fn(async () => [
    { num: 9, gen: 0 },
    { name: "Fit" },
  ]);
  const doc = {
    numPages: 600,
    getPageLabels: async () => ["i", "ii", "1", "2", "3"],
    getPageIndex,
    getDestination,
  };
  const cache = new Map();
  const outline = [
    {
      title: "Front",
      dest: [1, { name: "Fit" }],
      items: [{ title: "Chapter", dest: "chapter-one", items: [] }],
    },
  ];
  await resolveChapterPages(
    doc as any,
    outline,
    cache,
    () => {},
    () => false,
  );
  expect([...cache.values()]).toEqual([
    { page: 2, label: "ii" },
    { page: 5, label: "3" },
  ]);
  await resolveChapterPages(
    doc as any,
    outline,
    cache,
    () => {},
    () => false,
  );
  expect(getDestination).toHaveBeenCalledTimes(1);
  expect(getPageIndex).toHaveBeenCalledTimes(1);
});

it("keeps malformed and out-of-range destinations unnumbered", async () => {
  const doc = {
    numPages: 3,
    getPageLabels: async () => null,
    getDestination: async () => {
      throw new Error("Bad destination");
    },
  };
  const cache = new Map();
  await resolveChapterPages(
    doc as any,
    [
      { title: "Bad", dest: "missing", items: [] },
      { title: "Outside", dest: [9], items: [] },
    ],
    cache,
    () => {},
    () => false,
  );
  expect(cache.size).toBe(0);
});
