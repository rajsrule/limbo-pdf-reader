import { mkdir, writeFile } from "node:fs/promises";
await mkdir("src-tauri/installer", { recursive: true });
function bmp(w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const bytes = Buffer.alloc(54 + row * h);
  bytes.write("BM");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(w, 18);
  bytes.writeInt32LE(h, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 54 + (h - 1 - y) * row + x * 3;
      const glow = Math.max(
        0,
        1 - Math.hypot((x - w * 0.5) / w, (y - h * 0.35) / h),
      );
      let c = [9 + glow * 6, 6 + glow * 3, 14 + glow * 12];
      if ((x * 137 + y * 51) % 1543 === 0) c = [159, 130, 192];
      const cx = w * 0.5,
        cy = h * 0.33,
        scale = Math.min(w / 160, h / 150);
      const d = Math.hypot(x - cx, y - cy);
      if (
        Math.abs(d - 22 * scale) < 1.6 * scale ||
        (Math.abs(x - cx) < 1.6 * scale &&
          y > cy + 22 * scale &&
          y < cy + 70 * scale) ||
        ((Math.abs(y - (cy + 48 * scale)) < 1.6 * scale ||
          Math.abs(y - (cy + 61 * scale)) < 1.6 * scale) &&
          x > cx &&
          x < cx + 14 * scale)
      )
        c = [190, 156, 228];
      bytes[i] = c[2];
      bytes[i + 1] = c[1];
      bytes[i + 2] = c[0];
    }
  return bytes;
}
await writeFile("src-tauri/installer/header.bmp", bmp(150, 57));
await writeFile("src-tauri/installer/sidebar.bmp", bmp(164, 314));
