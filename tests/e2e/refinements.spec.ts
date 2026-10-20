import { test, expect } from "@playwright/test";
import path from "node:path";
async function open(page: any) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Open PDF (Ctrl+O)", exact: true })
    .click();
  await (
    await chooser
  ).setFiles(path.resolve("tests/fixtures/Reading sample.pdf"));
  await expect(page.locator(".pdfViewer .page canvas").first()).toBeVisible();
  await expect(page.locator(".loading-overlay")).toHaveCount(0);
}
test("black surfaces, chapter pages and held original-color preview", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".reader-status")).toHaveCount(0);
  for (const selector of [
    ".titlebar",
    ".tabstrip",
    ".reader-toolbar",
    ".viewer-stage",
  ])
    expect(
      await page
        .locator(selector)
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(0, 0, 0)");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(page.locator(".chapter-page")).toHaveText(["1", "2", "5"]);
  expect(
    await page
      .locator(".outline-item")
      .first()
      .evaluate((el) => getComputedStyle(el).borderBottomStyle),
  ).toBe("solid");
  const background = () =>
    page
      .locator(".pdfViewer .page canvas")
      .first()
      .evaluate((canvas: any) =>
        Array.from(canvas.getContext("2d").getImageData(5, 5, 1, 1).data).slice(
          0,
          3,
        ),
      );
  await page.keyboard.down("Backslash");
  await expect(page.locator(".preview-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(background).toEqual([255, 255, 255]);
  await page.keyboard.up("Backslash");
  await expect.poll(background).toEqual([0, 0, 0]);
  await page.keyboard.down("Backslash");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".preview-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.up("Backslash");
  await page.screenshot({ path: "docs/screenshots/reading.png" });
});
test("mouse highlights survive autosave and comment dialogs cover editor menus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const line = page
    .locator(".textLayer span")
    .filter({ hasText: "PDFs should feel comfortable" });
  const box = await line.boundingBox();
  await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const highlight = page.locator(".textLayer .editToolbar .highlightButton");
  await expect(highlight).toBeVisible();
  const start = Date.now();
  await highlight.click();
  await expect(page.locator(".highlightEditor")).toHaveCount(1);
  expect(Date.now() - start).toBeLessThan(2000);
  await page.waitForTimeout(4300);
  await expect(page.locator(".highlightEditor.selectedEditor")).toHaveCount(1);
  const toolbar = page.locator(".highlightEditor .editToolbar");
  const picker = toolbar.locator("button.colorPicker");
  await expect(toolbar.locator(".dropdown")).toBeHidden();
  await picker.click();
  await expect(toolbar.locator(".dropdown")).toBeVisible();
  expect(
    (await toolbar.locator(".dropdown").boundingBox())!.width,
  ).toBeLessThan(110);
  expect(
    await toolbar
      .locator("button.comment")
      .evaluate((el) => getComputedStyle(el, "::before").maskImage),
  ).toContain("comment-editButton.svg");
  await toolbar.locator("button.comment").click();
  const input = page.getByLabel("Comment", { exact: true });
  await expect(input).toBeFocused();
  await input.fill("Clear controls, no overlapping toolbars.");
  const save = page.getByRole("button", { name: "Save comment", exact: true });
  expect(
    await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: "docs/screenshots/annotation.png" });
  await save.click();
  await expect(page.locator(".modal-shade")).toHaveCount(0);
  expect(errors).toEqual([]);
});
