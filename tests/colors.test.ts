import { describe, expect, it } from "vitest";
import { limboNeutralColor } from "../src/neutral-color.js";
describe("image-independent neutral remapping", () => {
  it("maps white paper to OLED black and black ink to soft white", () => {
    expect(limboNeutralColor("#ffffff")).toBe("#000000");
    expect(limboNeutralColor("#000000")).toBe("#eeeeee");
  });
  it("preserves blue, red, and pale colored graphics exactly", () => {
    for (const c of ["#1966e6", "#cc334d", "#d0dcfa", "#1d876e"])
      expect(limboNeutralColor(c)).toBe(c);
  });
  it("handles a neutral ramp continuously", () => {
    let previous = 256;
    for (let n = 0; n <= 255; n++) {
      const c = "#" + n.toString(16).padStart(2, "0").repeat(3);
      const mapped = parseInt(limboNeutralColor(c).slice(1, 3), 16);
      expect(mapped).toBeLessThanOrEqual(previous);
      previous = mapped;
    }
  });
  it("does not reinterpret patterns or transparency", () => {
    expect(limboNeutralColor("transparent")).toBe("transparent");
    expect(limboNeutralColor("CanvasText")).toBe("CanvasText");
  });
});
