import { test, expect } from "@playwright/test";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
const sample = path.resolve("tests/fixtures/Reading sample.pdf"),
  companion = path.resolve("tests/fixtures/Companion notes.pdf");
async function open(page: any, files: string | string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Open PDF (Ctrl+O)", exact: true })
    .click();
  await (await chooser).setFiles(files);
  await expect(page.locator(".loading-overlay")).toHaveCount(0);
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible();
}
test("welcome and keyboard-accessible split layout", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Read a little closer to the dark." }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/welcome.png" });
  await page
    .getByRole("button", { name: "Toggle split view (Ctrl+\\)", exact: true })
    .click();
  await expect(page.locator(".pane")).toHaveCount(2);
  await page.keyboard.press("Control+Backslash");
  await expect(page.locator(".pane")).toHaveCount(1);
});
test("digital colors, dark pages, scanned fallback, navigation, and outline", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await open(page, sample);
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    "Smart Dark · colors preserved",
  );
  const pixel = async (x: number, y: number) =>
    page
      .locator(".pdfViewer .page canvas")
      .first()
      .evaluate(
        (el: any, { x, y }: any) => {
          const d = el
            .getContext("2d")
            .getImageData(
              Math.floor((x / 612) * el.width),
              Math.floor(((792 - y) / 792) * el.height),
              1,
              1,
            ).data;
          return Array.from(d).slice(0, 3);
        },
        { x, y },
      );
  expect(await pixel(20, 700)).toEqual([0, 0, 0]);
  const blue = await pixel(100, 300);
  expect(blue[2]).toBeGreaterThan(blue[0] * 3);
  const image = await pixel(430, 300);
  const imageDigest = () =>
    page
      .locator(".pdfViewer .page canvas")
      .first()
      .evaluate(async (canvas: any) => {
        const x = Math.ceil((411 / 612) * canvas.width),
          y = Math.ceil(((792 - 366) / 792) * canvas.height);
        const data = canvas
          .getContext("2d")
          .getImageData(
            x,
            y,
            Math.floor((146 / 612) * canvas.width),
            Math.floor((89 / 792) * canvas.height),
          ).data;
        return Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        )
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      });
  const originalImageDigest = await imageDigest();
  await page
    .getByLabel("Page colors", { exact: true })
    .selectOption("original");
  await expect.poll(() => pixel(20, 700)).toEqual([255, 255, 255]);
  expect(await pixel(430, 300)).toEqual(image);
  expect(await imageDigest()).toEqual(originalImageDigest);
  expect(await pixel(100, 300)).toEqual(blue);
  await page.getByLabel("Page colors", { exact: true }).selectOption("smart");
  await page.getByLabel("Page number", { exact: true }).fill("2");
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    /Already dark/,
  );
  await page.getByLabel("Page number", { exact: true }).fill("3");
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    /scanned page/,
  );
  await page.getByLabel("Page number", { exact: true }).fill("4");
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    /complex artwork/,
  );
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "A quieter place", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "A quieter place", exact: true })
    .click();
  await page.getByLabel("Zoom", { exact: true }).selectOption("page-fit");
  await page.screenshot({ path: "docs/screenshots/reading.png" });
  expect(errors).toEqual([]);
});
test("tabs split, independent navigation, merge, and search", async ({
  page,
}) => {
  await page.goto("/");
  await open(page, [sample, companion]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Control+Backslash");
  await expect(page.locator(".reader")).toHaveCount(2);
  await expect(page.locator(".loading-overlay")).toHaveCount(0);
  const readers = page.locator(".reader");
  await readers.nth(1).getByLabel("Page number", { exact: true }).fill("2");
  await expect(
    readers.nth(0).getByLabel("Page number", { exact: true }),
  ).toHaveValue("1");
  await page.screenshot({ path: "docs/screenshots/split.png" });
  await page.keyboard.press("Control+Backslash");
  await expect(page.locator(".reader")).toHaveCount(1);
  await page.keyboard.press("Control+f");
  await page.getByLabel("Search PDF", { exact: true }).fill("Compare");
  await expect(page.locator(".find-bar")).toContainText("/");
});
test("compact welcome fits 360 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open a PDF Ctrl O" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
});
test("highlight, attached comment, export, and draft recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await open(page, sample);
  await expect(
    page
      .locator(".textLayer span")
      .filter({ hasText: "PDFs should feel comfortable" }),
  ).toBeVisible();
  await page
    .locator(".textLayer span")
    .filter({ hasText: "PDFs should feel comfortable" })
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  await page
    .getByRole("button", { name: "Highlight text", exact: true })
    .click();
  await expect(page.locator(".highlightEditor")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Comment on this highlight" }),
  ).toBeVisible();
  await page
    .getByLabel("Comment", { exact: true })
    .fill("A note that travels with the document.");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+s");
  const file = await download;
  await file.saveAs("test-results/annotated.pdf");
  await page
    .getByRole("button", { name: "Close Reading sample.pdf", exact: true })
    .click();
  await open(page, sample);
  await expect(page.locator(".save-status")).toContainText("Draft restored");
  await expect(
    page.locator(".annotationLayer .highlightAnnotation"),
  ).toHaveCount(1);
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    "Smart Dark · colors preserved",
  );
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await page.getByRole("button", { name: "Annotations", exact: true }).click();
  await expect(page.locator(".markup-card")).toContainText(
    "A note that travels",
  );
  await page.getByRole("button", { name: "Edit comment", exact: true }).click();
  await page.getByLabel("Comment", { exact: true }).fill("An edited note.");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await expect(page.locator(".markup-card")).toContainText("An edited note.");
  await page
    .getByRole("button", { name: "Delete annotation", exact: true })
    .click();
  await expect(page.locator(".markup-card")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await page
    .getByRole("button", { name: "More reading tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save local draft Ctrl+S", exact: true })
    .click();
  expect(errors).toEqual([]);
});
test("tabs move between groups using pointer gestures", async ({ page }) => {
  await page.goto("/");
  await open(page, [sample, companion]);
  await page.keyboard.press("Control+Backslash");
  await expect(page.locator(".reader")).toHaveCount(2);
  const tab = await page.locator(".pane").nth(1).getByRole("tab").boundingBox();
  const target = await page
    .locator(".pane")
    .nth(0)
    .locator(".tabstrip")
    .boundingBox();
  await page.mouse.move(tab!.x + 45, tab!.y + 14);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width - 45, target!.y + 14, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator(".pane").nth(0).getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".pane").nth(1).getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".reader")).toHaveCount(1);
});
test("600-page document renders on demand", async ({ page }) => {
  await page.goto("/");
  const start = Date.now();
  await open(page, path.resolve("tests/fixtures/Large document.pdf"));
  const firstPageMs = Date.now() - start;
  await page.getByLabel("Page number", { exact: true }).fill("599");
  await expect(page.getByLabel("Page colors", { exact: true })).toHaveAttribute(
    "title",
    /Smart Dark/,
  );
  await expect(
    page.getByText("Large document / page 599", { exact: true }),
  ).toBeVisible();
  const canvases = await page.locator(".pdfViewer .page canvas").count();
  expect(canvases).toBeLessThanOrEqual(7);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/browser-benchmark.json",
    JSON.stringify(
      {
        environment:
          "Chromium 141, frontend preview, 1280x900, local generated 600-page PDF",
        firstPageMs,
        livePageCanvasesAfterJump: canvases,
        totalPages: 600,
        note: "Does not measure cold native-process or WebView2 startup.",
      },
      null,
      2,
    ),
  );
});
