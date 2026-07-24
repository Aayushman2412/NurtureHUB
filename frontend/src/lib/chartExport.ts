/**
 * Dependency-free export of the growth charts (SVG) to PNG.
 *
 * The charts style themselves with Tailwind classes that resolve to CSS custom
 * properties (e.g. `fill-ink-muted` → `var(--color-ink-muted)`). A serialized,
 * detached SVG has no access to that stylesheet, so before rasterising we walk
 * the live node and inline each element's *computed* presentation values as
 * attributes — which resolves the variables to concrete colours.
 */

// Presentation properties worth carrying onto the standalone SVG. (font-family is
// deliberately excluded — see EXPORT_FONT.)
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
  'font-size', 'font-weight', 'text-anchor',
];

// The app's web fonts (Figtree / Nunito Sans / Noto Sans Devanagari) are loaded via
// a <link> and are NOT reachable inside the detached <img> that rasterises the SVG,
// so copying their names would just fall back per-OS (Hindi labels worst hit). Pin a
// system stack that covers Latin + Devanagari for predictable, legible exports.
const EXPORT_FONT =
  "'Segoe UI', system-ui, -apple-system, 'Nirmala UI', 'Noto Sans', 'Noto Sans Devanagari', Arial, sans-serif";

function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = window.getComputedStyle(src);
  for (const prop of STYLE_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value) dst.setAttribute(prop, value);
  }
  const srcChildren = src.children;
  const dstChildren = dst.children;
  for (let i = 0; i < srcChildren.length; i++) {
    if (dstChildren[i]) inlineComputedStyles(srcChildren[i], dstChildren[i]);
  }
}

const TITLE_BAND = 48; // px reserved above the plot for the title/subtitle

/** Rasterise one chart SVG to a white-background canvas (with an optional title band). */
export async function svgToCanvas(
  svg: SVGSVGElement,
  opts: { scale?: number; title?: string; subtitle?: string } = {},
): Promise<HTMLCanvasElement> {
  const scale = opts.scale ?? 2;
  const box = svg.viewBox.baseVal;
  const w = box?.width || svg.clientWidth || 760;
  const h = box?.height || svg.clientHeight || 480;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('font-family', EXPORT_FONT); // inherited by all <text> in the raster context
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));

  const xml = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('chart image failed to load'));
    img.src = url;
  });

  const bandH = opts.title ? TITLE_BAND : 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round((h + bandH) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h + bandH);
  if (opts.title) {
    ctx.fillStyle = '#1f2937';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(opts.title, 10, 22);
    if (opts.subtitle) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillText(opts.subtitle, 10, 39);
    }
  }
  ctx.drawImage(img, 0, bandH, w, h);
  return canvas;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';

/** Download a single chart as a PNG. */
export async function downloadChartPng(
  svg: SVGSVGElement,
  filename: string,
  title?: string,
  subtitle?: string,
): Promise<void> {
  const canvas = await svgToCanvas(svg, { title, subtitle });
  downloadCanvas(canvas, filename);
}

/** Stack every chart SVG into one tall PNG and download it. */
export async function downloadChartsCombined(
  svgs: SVGSVGElement[],
  filename: string,
): Promise<void> {
  if (svgs.length === 0) return;
  const canvases = await Promise.all(
    svgs.map(svg =>
      svgToCanvas(svg, {
        title: svg.getAttribute('data-chart-title') ?? undefined,
        subtitle: svg.getAttribute('data-chart-subtitle') ?? undefined,
      }),
    ),
  );
  const gap = 24;
  const width = Math.max(...canvases.map(c => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0) + gap * (canvases.length + 1);

  const canvas = document.createElement('canvas');
  canvas.width = width + gap * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = gap;
  for (const c of canvases) {
    ctx.drawImage(c, gap, y);
    y += c.height + gap;
  }
  downloadCanvas(canvas, filename);
}
