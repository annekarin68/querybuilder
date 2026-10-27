// Colour maths with no DOM, so Node tests can reach it.
//
// Blends are done in OKLab, not in RGB: halfway between two RGB colours is
// often a muddy, darker colour, while OKLab is built so that equal steps look
// like equal steps. (OKLab also has no hue wrap-around to handle, unlike OKLCH.)

export type Rgb = [number, number, number];

/** "#rrggbb" -> [r, g, b], each 0 to 255. Only the opaque 6-digit form. */
export function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

// Björn Ottosson's OKLab matrices (https://bottosson.github.io/posts/oklab/).
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function toOklab([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** The colour `t` of the way from `a` (t = 0) to `b` (t = 1), blended in OKLab. */
export function mixOklab(a: string, b: string, t: number): string {
  const [L1, A1, B1] = toOklab(parseHex(a));
  const [L2, A2, B2] = toOklab(parseHex(b));
  return toHex(fromOklab([L1 + (L2 - L1) * t, A1 + (A2 - A1) * t, B1 + (B2 - B1) * t]));
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio, 1 to 21, whichever colour is lighter. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Of two candidate colours, the one that contrasts more with `bg`
 *  (for a dot or label drawn on a colour we only know at run time). */
export function betterOn(bg: string, dark: string, light: string): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}
