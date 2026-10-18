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

  // The inlined styles are the *computed* (theme-resolved) colours, so a chart
  // captured in dark mode has light ink text — paint the matching dark surface
  // behind it instead of white, or the labels are near-invisible.
  const dark = document.documentElement.classList.contains('dark');

  const bandH = opts.title ? TITLE_BAND : 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round((h + bandH) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(scale, scale);
  ctx.fillStyle = dark ? '#211D1A' : '#ffffff'; // --surface per theme.css
  ctx.fillRect(0, 0, w, h + bandH);
  if (opts.title) {
    ctx.fillStyle = dark ? '#F3EFE9' : '#1f2937';
    ctx.font = '600 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(opts.title, 10, 22);
    if (opts.subtitle) {
      ctx.fillStyle = dark ? '#C6BDB0' : '#6b7280';
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

/**
 * A table as a picture the learner can open and zoom (review of 18 Oct 2026:
 * "make those tables into a downloadable image so that they can open and
 * zoom"). Drawn cell by cell onto a canvas from the table on screen — its
 * text, fills, weight and spans — so no screenshot library is needed. Long
 * text wraps at MAX_COL px; the picture is drawn at 2x for sharp zooming.
 */
export function downloadTablePng(table: HTMLTableElement, filename: string, title?: string): void {
  const SCALE = 2, PAD_X = 8, PAD_Y = 6, LINE = 17, MAX_COL = 260, MIN_COL = 36;
  const dark = document.documentElement.classList.contains('dark');
  const pageBg = dark ? '#211D1A' : '#ffffff';
  const ink = dark ? '#F5EFE8' : '#2B2420';
  const grid = dark ? '#5A5048' : '#CFC4B8';
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return;
  const fontFor = (weight: string) => `${Number(weight) >= 600 ? 'bold ' : ''}13px system-ui, -apple-system, "Segoe UI", sans-serif`;

  type Cell = { r: number; c: number; rs: number; cs: number; lines: string[]; bg: string; color: string; weight: string; align: string };
  const cells: Cell[] = [];
  const taken: boolean[][] = [];
  const rows = Array.from(table.rows);
  rows.forEach((tr, r) => {
    let c = 0;
    for (const td of Array.from(tr.cells)) {
      while (taken[r]?.[c]) c++;
      const st = getComputedStyle(td);
      const bg = st.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(st.backgroundColor) ? st.backgroundColor : '';
      const text = (td.innerText || '').replace(/\u00a0/g, ' ').trim();
      const cell: Cell = {
        r, c, rs: Math.max(1, td.rowSpan || 1), cs: Math.max(1, td.colSpan || 1),
        lines: [], bg, color: st.color || ink, weight: st.fontWeight || '400',
        align: td.tagName === 'TH' && (td.colSpan || 1) > 1 ? 'center' : (st.textAlign === 'right' ? 'right' : st.textAlign === 'center' ? 'center' : 'left'),
      };
      measure.font = fontFor(cell.weight);
      for (const raw of (text || '').split(/\r?\n/)) {
        let line = '';
        for (const word of raw.split(/\s+/).filter(Boolean)) {
          const next = line ? `${line} ${word}` : word;
          if (line && measure.measureText(next).width > MAX_COL - 2 * PAD_X) { cell.lines.push(line); line = word; } else line = next;
        }
        cell.lines.push(line);
      }
      if (!cell.lines.length) cell.lines.push('');
      for (let i = 0; i < cell.rs; i++) for (let j = 0; j < cell.cs; j++) {
        (taken[r + i] ??= [])[c + j] = true;
      }
      cells.push(cell);
      c += cell.cs;
    }
  });
  const nCols = Math.max(0, ...cells.map(x => x.c + x.cs));
  const nRows = rows.length;
  const width = (x: Cell) => {
    measure.font = fontFor(x.weight);
    return Math.min(MAX_COL, Math.max(...x.lines.map(l => measure.measureText(l).width)) + 2 * PAD_X);
  };
  const colW = Array<number>(nCols).fill(MIN_COL);
  for (const x of cells) if (x.cs === 1) colW[x.c] = Math.max(colW[x.c], width(x));
  for (const x of cells) if (x.cs > 1) {
    const have = colW.slice(x.c, x.c + x.cs).reduce((a, b) => a + b, 0);
    const need = width(x);
    if (need > have) for (let j = 0; j < x.cs; j++) colW[x.c + j] += (need - have) / x.cs;
  }
  const rowH = Array<number>(nRows).fill(LINE + 2 * PAD_Y);
  for (const x of cells) if (x.rs === 1) rowH[x.r] = Math.max(rowH[x.r], x.lines.length * LINE + 2 * PAD_Y);
  const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));
  const rowY = rowH.map((_, i) => rowH.slice(0, i).reduce((a, b) => a + b, 0));
  const head = title ? 34 : 0;
  const margin = 12;
  const totalW = colW.reduce((a, b) => a + b, 0);
  const totalH = rowH.reduce((a, b) => a + b, 0);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((totalW + 2 * margin) * SCALE);
  canvas.height = Math.ceil((totalH + head + 2 * margin) * SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = pageBg;
  ctx.fillRect(0, 0, totalW + 2 * margin, totalH + head + 2 * margin);
  if (title) {
    ctx.fillStyle = ink;
    ctx.font = 'bold 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, margin, margin + 12);
  }
  const ox = margin, oy = margin + head;
  ctx.textBaseline = 'top';
  for (const x of cells) {
    const left = ox + colX[x.c];
    const top = oy + rowY[x.r];
    const w = colW.slice(x.c, x.c + x.cs).reduce((a, b) => a + b, 0);
    const h = rowH.slice(x.r, x.r + x.rs).reduce((a, b) => a + b, 0);
    ctx.fillStyle = x.bg || pageBg;
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, w, h);
    ctx.fillStyle = x.color;
    ctx.font = fontFor(x.weight);
    x.lines.forEach((line, i) => {
      const tw = ctx.measureText(line).width;
      const tx = x.align === 'center' ? left + (w - tw) / 2 : x.align === 'right' ? left + w - PAD_X - tw : left + PAD_X;
      ctx.fillText(line, tx, top + PAD_Y + i * LINE, w - 2 * PAD_X);
    });
  }
  downloadCanvas(canvas, filename);
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
  ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#211D1A' : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = gap;
  for (const c of canvases) {
    ctx.drawImage(c, gap, y);
    y += c.height + gap;
  }
  downloadCanvas(canvas, filename);
}
