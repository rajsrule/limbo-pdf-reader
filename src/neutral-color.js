// RGB colors are already normalized by PDF.js. Chroma is absolute, so pale
// blue is preserved rather than accidentally treated as gray at low saturation.
export function limboNeutralColor(color) {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) return color;
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  if (Math.max(r, g, b) - Math.min(r, g, b) > 12) return color;
  const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const value = Math.round((1 - lightness) * 238);
  return '#' + value.toString(16).padStart(2, '0').repeat(3);
}
