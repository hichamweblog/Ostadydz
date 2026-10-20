import { strToU8, zipSync } from 'fflate';

/**
 * Phase 6 — real Microsoft Word (.docx) export.
 *
 * The old exporters emitted HTML renamed to `.doc`. Every export icon in the app now goes
 * through this module, which packages a genuine Office Open XML document:
 *   - A4 page (portrait or landscape) with sane margins;
 *   - full right-to-left layout (`<w:bidi/>` section + paragraphs, `<w:bidiVisual/>` tables);
 *   - headings, paragraphs, lists and bordered tables mapped from the exporters' HTML.
 *
 * The HTML → WordprocessingML conversion is pure TypeScript (no DOM APIs) so it runs
 * identically in the browser and under vitest (node environment).
 */

export interface DocxExportOptions {
  landscape?: boolean;
  title?: string;
}

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ------------------------------------------------------------------ */
/* Minimal HTML parsing (the exporters produce well-formed markup)    */
/* ------------------------------------------------------------------ */

export interface HtmlNode {
  type: 'element' | 'text';
  tag?: string;
  attrs?: Record<string, string>;
  children?: HtmlNode[];
  text?: string;
  image?: { id: number; width: number; height: number };
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr']);
const SKIP_TAGS = new Set(['style', 'script', 'head', 'title', 'meta', 'link']);
const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'table', 'ul', 'ol', 'li',
  'section', 'article', 'header', 'footer', 'center', 'blockquote', 'hr', 'figure', 'html', 'body',
]);

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?[A-Za-z][^>]*>/g;
const ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>=]+))?/g;

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', bull: '•' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw))) {
    const name = match[1].toLowerCase();
    let value = match[2] ?? '';
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    attrs[name] = value;
  }
  return attrs;
}

/** Parses an HTML fragment into a node tree; unknown/malformed tags degrade gracefully. */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode = { type: 'element', tag: 'root', children: [] };
  const stack: HtmlNode[] = [root];
  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (!text) return;
    const top = stack[stack.length - 1];
    (top.children ||= []).push({ type: 'text', text: decodeHtmlEntities(text) });
  };

  while ((match = TAG_RE.exec(html))) {
    const token = match[0];
    pushText(html.slice(lastIndex, match.index));
    lastIndex = match.index + token.length;

    if (token.startsWith('<!--') || token.startsWith('<!')) continue; // comments / doctype

    if (token[1] === '/') {
      const tag = token.slice(2, -1).trim().toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const inner = token.slice(1, token.endsWith('/>') ? -2 : -1);
    const tagMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(inner);
    const tag = (tagMatch ? tagMatch[0] : '').toLowerCase();
    if (!tag) continue;
    const attrs = parseAttrs(inner.slice(tag.length));
    const selfClosing = token.endsWith('/>') || VOID_TAGS.has(tag);

    if (SKIP_TAGS.has(tag)) {
      // swallow the content of <style>/<script>/<head> blocks
      if (!selfClosing) {
        const closeIdx = html.toLowerCase().indexOf(`</${tag}>`, lastIndex);
        if (closeIdx !== -1) {
          lastIndex = closeIdx + tag.length + 3;
          TAG_RE.lastIndex = lastIndex;
        }
      }
      continue;
    }

    const node: HtmlNode = { type: 'element', tag, attrs, children: [] };
    (stack[stack.length - 1].children ||= []).push(node);
    if (!selfClosing) stack.push(node);
  }
  pushText(html.slice(lastIndex));
  return root.children || [];
}

/* ------------------------------------------------------------------ */
/* Style helpers                                                       */
/* ------------------------------------------------------------------ */

const NAMED_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  gray: '808080', grey: '808080', darkgray: 'A9A9A9', darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3', lightgrey: 'D3D3D3', silver: 'C0C0C0', maroon: '800000',
  navy: '000080', teal: '008080', olive: '808000', purple: '800080', fuchsia: 'FF00FF',
  lime: '00FF00', orange: 'FFA500', gold: 'FFD700', yellow: 'FFFF00', brown: 'A52A2A',
  firebrick: 'B22222', crimson: 'DC143C', darkred: '8B0000', darkblue: '00008B',
  darkgreen: '006400', darkslategray: '2F4F4F', slategray: '708090', slategrey: '708090',
  whitesmoke: 'F5F5F5', snow: 'FFFAFA', ivory: 'FFFFF0', lemonchiffon: 'FFFACD',
  honeydew: 'F0FFF0', aliceblue: 'F0F8FF', beige: 'F5F5DC', transparent: '',
};

function colorToHex(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  if (clean.startsWith('#')) {
    let hex = clean.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase();
    if (/^[0-9a-f]{8}$/.test(hex)) return hex.slice(0, 6).toUpperCase();
    return null;
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(clean);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  const named = NAMED_COLORS[clean];
  return named ? named : null;
}

interface CssStyle {
  align?: 'center' | 'left' | 'right' | 'justify';
  color?: string;
  background?: string;
  fontSizeHalfPoints?: number;
  bold?: boolean;
}

function parseStyleAttribute(style: string | undefined): CssStyle {
  const out: CssStyle = {};
  if (!style) return out;
  for (const declaration of style.split(';')) {
    const idx = declaration.indexOf(':');
    if (idx === -1) continue;
    const prop = declaration.slice(0, idx).trim().toLowerCase();
    const value = declaration.slice(idx + 1).trim();
    switch (prop) {
      case 'text-align':
        if (value === 'center' || value === 'left' || value === 'right' || value === 'justify') {
          out.align = value;
        }
        break;
      case 'color': {
        const hex = colorToHex(value);
        if (hex) out.color = hex;
        break;
      }
      case 'background':
      case 'background-color': {
        const hex = colorToHex(value);
        if (hex) out.background = hex;
        break;
      }
      case 'font-size': {
        const pt = /^([\d.]+)\s*pt$/.exec(value);
        const px = /^([\d.]+)\s*px$/.exec(value);
        if (pt) out.fontSizeHalfPoints = Math.round(Number(pt[1]) * 2);
        else if (px) out.fontSizeHalfPoints = Math.round(Number(px[1]) * 1.5);
        break;
      }
      case 'font-weight':
        if (value === 'bold' || value === 'bolder' || Number(value) >= 600) out.bold = true;
        break;
      default:
        break;
    }
  }
  return out;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ */
/* WordprocessingML generation                                         */
/* ------------------------------------------------------------------ */

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  sizeHalfPoints?: number;
}

function runPropertiesXml(style: RunStyle): string {
  const parts: string[] = [];
  if (style.bold) parts.push('<w:b/>');
  if (style.italic) parts.push('<w:i/>');
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.color) parts.push(`<w:color w:val="${style.color}"/>`);
  if (style.sizeHalfPoints) {
    parts.push(`<w:sz w:val="${style.sizeHalfPoints}"/><w:szCs w:val="${style.sizeHalfPoints}"/>`);
  }
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function paragraphXml(runsXml: string, options: {
  align?: CssStyle['align'];
  shading?: string;
  indentRight?: number;
  spacingAfter?: number;
  border?: boolean;
  keepEmpty?: boolean;
} = {}): string {
  const pPrParts: string[] = ['<w:bidi/>'];
  if (options.border) {
    pPrParts.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>');
  }
  if (options.shading) pPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  if (options.indentRight) pPrParts.push(`<w:ind w:right="${options.indentRight}"/>`);
  const spacing = options.spacingAfter ?? 80;
  pPrParts.push(`<w:spacing w:after="${spacing}"/>`);
  const align = options.align ?? 'right';
  const jc = align === 'center' ? 'center' : align === 'left' ? 'left' : align === 'justify' ? 'both' : 'right';
  pPrParts.push(`<w:jc w:val="${jc}"/>`);
  return `<w:p><w:pPr>${pPrParts.join('')}</w:pPr>${runsXml}</w:p>`;
}

function textRunXml(text: string, style: RunStyle): string {
  if (!text) return '';
  return `<w:r>${runPropertiesXml(style)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** Renders the inline content of a node into Word runs. */
function renderRuns(node: HtmlNode, inherited: RunStyle, out: string[]): void {
  if (node.type === 'text') {
    const text = node.text || '';
    if (text.trim() || text) out.push(textRunXml(text.replace(/\s+/g, ' '), inherited));
    return;
  }
  const tag = node.tag || '';
  const css = parseStyleAttribute(node.attrs?.style);
  const style: RunStyle = { ...inherited };
  if (tag === 'b' || tag === 'strong' || css.bold) style.bold = true;
  if (tag === 'i' || tag === 'em') style.italic = true;
  if (tag === 'u' || tag === 'ins') style.underline = true;
  if (css.color) style.color = css.color;
  if (css.fontSizeHalfPoints) style.sizeHalfPoints = css.fontSizeHalfPoints;

  if (tag === 'br') {
    out.push(`<w:r>${runPropertiesXml(style)}<w:br/></w:r>`);
    return;
  }
  if (tag === 'img') {
    if (node.image) {
      const { id, width, height } = node.image;
      out.push(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="صورة ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="صورة ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`);
    } else if (node.attrs?.alt) {
      out.push(textRunXml(decodeHtmlEntities(node.attrs.alt), style));
    }
    return;
  }
  for (const child of node.children || []) renderRuns(child, style, out);
}

interface CellModel {
  node: HtmlNode;
  colspan: number;
  rowspan: number;
  isHeader: boolean;
  css: CssStyle;
  widthPercent?: number;
}

interface RowModel {
  cells: CellModel[];
}

function collectRows(node: HtmlNode): RowModel[] {
  const rows: RowModel[] = [];
  const walk = (current: HtmlNode) => {
    for (const child of current.children || []) {
      if (child.type !== 'element') continue;
      if (child.tag === 'tr') {
        const cells: CellModel[] = (child.children || [])
          .filter((cell) => cell.type === 'element' && (cell.tag === 'td' || cell.tag === 'th'))
          .map((cell) => {
            const colspan = Math.max(1, parseInt(cell.attrs?.colspan || '1', 10) || 1);
            const rowspan = Math.max(1, parseInt(cell.attrs?.rowspan || '1', 10) || 1);
            const css = parseStyleAttribute(cell.attrs?.style);
            const widthAttr = cell.attrs?.width;
            const widthPercent =
              (widthAttr && /%$/.test(widthAttr) ? parseFloat(widthAttr) : NaN) ||
              (css ? parseWidthPercent(cell.attrs?.style) : NaN);
            return {
              node: cell,
              colspan,
              rowspan,
              isHeader: cell.tag === 'th',
              css,
              widthPercent: Number.isFinite(widthPercent) ? widthPercent : undefined,
            };
          });
        if (cells.length) rows.push({ cells });
      } else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        walk(child);
      }
    }
  };
  walk(node);
  return rows;
}

function parseWidthPercent(style: string | undefined): number {
  if (!style) return NaN;
  const match = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*%/i.exec(style);
  return match ? parseFloat(match[1]) : NaN;
}

const PAGE_TWIPS = {
  portrait: { width: 11906, height: 16838 },
  landscape: { width: 16838, height: 11906 },
};
const MARGIN_TWIPS = 1134; // 2 cm

function tableXml(node: HtmlNode, usableWidth: number): string {
  const rows = collectRows(node);
  if (!rows.length) return '';
  const gridCount = Math.max(...rows.map((row) => row.cells.reduce((sum, cell) => sum + cell.colspan, 0)));

  // Column widths: honour declared percentages when present, otherwise equal split.
  const widths: number[] = new Array(gridCount).fill(0);
  const declared: number[] = new Array(gridCount).fill(0);
  for (const row of rows) {
    let col = 0;
    for (const cell of row.cells) {
      if (cell.widthPercent && cell.colspan === 1 && col < gridCount) {
        declared[col] = Math.max(declared[col], cell.widthPercent);
      }
      col += cell.colspan;
    }
  }
  const declaredTotal = declared.reduce((sum, value) => sum + value, 0);
  for (let col = 0; col < gridCount; col++) {
    const percent = declared[col] > 0 ? declared[col] : declaredTotal > 0 ? (100 - declaredTotal) / (gridCount - declared.filter((v) => v > 0).length || 1) : 100 / gridCount;
    widths[col] = Math.max(1, Math.round((usableWidth * Math.max(1, percent)) / 100));
  }

  const widthSum = widths.reduce((a, b) => a + b, 0);
  for (let col = 0; col < gridCount; col++) widths[col] = Math.round(widths[col] * usableWidth / widthSum);

  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`)
    .join('');

  const gridXml = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');

  // Rowspan bookkeeping: vMerge restart/continue per grid column.
  const openMerges: number[] = new Array(gridCount).fill(0);
  const rowXmlParts: string[] = [];

  for (const row of rows) {
    const cellXmlParts: string[] = [];
    let col = 0;
    let cellIndex = 0;
    while (col < gridCount) {
      if (openMerges[col] > 0) {
        // continuation cell of a rowspan started in an earlier row
        const width = widths[col];
        cellXmlParts.push(
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vMerge/><w:vAlign w:val="center"/></w:tcPr>${paragraphXml('', { spacingAfter: 20 })}</w:tc>`,
        );
        openMerges[col] -= 1;
        col += 1;
        continue;
      }
      const cell = row.cells[cellIndex];
      if (!cell) {
        const width = widths[col];
        cellXmlParts.push(
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraphXml('', { spacingAfter: 20 })}</w:tc>`,
        );
        col += 1;
        continue;
      }
      cellIndex += 1;
      const width = widths.slice(col, col + cell.colspan).reduce((sum, value) => sum + value, 0);
      const tcPr: string[] = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
      if (cell.colspan > 1) tcPr.push(`<w:gridSpan w:val="${cell.colspan}"/>`);
      const shading = cell.css.background || (cell.isHeader ? 'E8F4F0' : null);
      if (shading) tcPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>`);
      tcPr.push('<w:vAlign w:val="center"/>');
      if (cell.rowspan > 1) {
        tcPr.push('<w:vMerge w:val="restart"/>');
        for (let offset = 0; offset < cell.colspan; offset++) {
          openMerges[col + offset] = cell.rowspan - 1;
        }
      }
      const baseStyle: RunStyle = cell.isHeader ? { bold: true } : {};
      const paragraphs = renderCellContent(cell.node, baseStyle, cell.css.align, Math.max(1, width - 160));
      cellXmlParts.push(`<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paragraphs}</w:tc>`);
      col += cell.colspan;
    }
    rowXmlParts.push(`<w:tr><w:trPr>${row.cells.every(c => c.isHeader) ? '<w:tblHeader/>' : ''}<w:cantSplit/></w:trPr>${cellXmlParts.join('')}</w:tr>`);
  }

  return (
    `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${gridXml}</w:tblGrid>${rowXmlParts.join('')}</w:tbl>` +
    paragraphXml('', { spacingAfter: 60 })
  );
}

/** Renders the content of a table cell as one or more paragraphs. */
function renderCellContent(node: HtmlNode, baseStyle: RunStyle, align: CssStyle['align'] | undefined, usableWidth: number): string {
  const blocks = renderBlocks(node.children || [], usableWidth, 0, { ...parseStyleAttribute(node.attrs?.style), align }, baseStyle);
  // A table cell must always end with a paragraph (even after a nested table).
  return blocks.length ? blocks.join('') : paragraphXml('', { align, spacingAfter: 0 });
}

const HEADING_SIZES: Record<string, number> = {
  h1: 32, h2: 28, h3: 24, h4: 22, h5: 22, h6: 20,
};

/** Renders a block-level subtree into a list of WordprocessingML blocks. */
function renderBlocks(nodes: HtmlNode[], usableWidth: number, listDepth = 0, inherited: CssStyle = {}, runStyle: RunStyle = {}): string[] {
  const blocks: string[] = [];
  let runs: string[] = [];
  let pendingAlign: CssStyle['align'] | undefined;
  let pendingShading: string | undefined;

  const flushParagraph = (extra: { align?: CssStyle['align']; shading?: string; indent?: number; spacing?: number } = {}) => {
    const content = runs.join('');
    if (content || extra.spacing !== undefined) {
      blocks.push(paragraphXml(content, {
        align: extra.align ?? pendingAlign ?? inherited.align,
        shading: extra.shading ?? pendingShading,
        indentRight: extra.indent,
        spacingAfter: extra.spacing,
      }));
    }
    runs = [];
    pendingAlign = undefined;
    pendingShading = undefined;
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      const text = (node.text || '').replace(/\s+/g, ' ');
      if (text.trim()) runs.push(textRunXml(text, runStyle));
      continue;
    }
    const tag = node.tag || '';
    const css = { ...inherited, ...parseStyleAttribute(node.attrs?.style) };
    if (node.attrs?.align && ["center", "left", "right", "justify"].includes(node.attrs.align)) css.align = node.attrs.align as CssStyle["align"];
    const style = { ...runStyle, bold: css.bold || runStyle.bold, color: css.color || runStyle.color, sizeHalfPoints: css.fontSizeHalfPoints || runStyle.sizeHalfPoints };

    if (tag === 'table') {
      flushParagraph();
      const table = tableXml(node, usableWidth);
      if (table) blocks.push(table);
      continue;
    }
    if (tag === 'hr') {
      flushParagraph();
      blocks.push(paragraphXml('', { border: true, spacingAfter: 80 }));
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      flushParagraph();
      let index = 1;
      for (const child of node.children || []) {
        if (child.type !== 'element' || child.tag !== 'li') continue;
        const prefix = tag === 'ol' ? `${index}. ` : '• ';
        index += 1;
        const itemRuns: string[] = [textRunXml(prefix, runStyle)];
        const nested: HtmlNode[] = [];
        for (const liChild of child.children || []) {
          if (liChild.type === 'element' && (liChild.tag === 'ul' || liChild.tag === 'ol')) {
            nested.push(liChild);
          } else {
            renderRuns(liChild, runStyle, itemRuns);
          }
        }
        blocks.push(paragraphXml(itemRuns.join(''), { indentRight: 284 + listDepth * 284, spacingAfter: 40 }));
        if (nested.length) blocks.push(...renderBlocks(nested, usableWidth, listDepth + 1, css, style));
      }
      continue;
    }
    if (HEADING_SIZES[tag]) {
      flushParagraph();
      const headingRuns: string[] = [];
      renderRuns(node, { ...style, bold: true, sizeHalfPoints: HEADING_SIZES[tag] }, headingRuns);
      blocks.push(paragraphXml(headingRuns.join(''), {
        align: css.align ?? 'center',
        shading: css.background,
        spacingAfter: 120,
      }));
      continue;
    }
    if (tag === 'p' || tag === 'div' || BLOCK_TAGS.has(tag)) {
      flushParagraph();
      // Inline children accumulate into one paragraph; block children become their own blocks.
      const hasBlockChild = (node.children || []).some(
        (child) => child.type === 'element' && child.tag && (BLOCK_TAGS.has(child.tag)),
      );
      if (!hasBlockChild) {
        const localRuns: string[] = [];
        renderRuns(node, style, localRuns);
        blocks.push(paragraphXml(localRuns.join(''), {
          align: css.align,
          shading: css.background,
          spacingAfter: tag === 'p' ? 80 : 60,
        }));
      } else {
        flushParagraph();
        blocks.push(...renderBlocks(node.children || [], usableWidth, listDepth, css, style));
      }
      continue;
    }
    // Inline element at block level (span, b, ...): fold into the current paragraph.
    if (css.align) pendingAlign = css.align;
    if (css.background) pendingShading = css.background;
    renderRuns(node, style, runs);
  }
  flushParagraph();
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Package assembly                                                    */
/* ------------------------------------------------------------------ */

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Amiri" w:hAnsi="Amiri" w:cs="Amiri" w:eastAsia="Amiri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

/** Builds every XML part of the .docx package for the given HTML content. */
export function buildDocxParts(html: string, options: DocxExportOptions = {}): Record<string, string> {
  const landscape = Boolean(options.landscape);
  const page = landscape ? PAGE_TWIPS.landscape : PAGE_TWIPS.portrait;
  const usableWidth = page.width - MARGIN_TWIPS * 2;
  const tree = parseHtml(html);
  const media = collectImages(tree);
  const blocks = renderBlocks(tree, usableWidth);
  const body = blocks.length ? blocks.join('') : paragraphXml('');
  const sectPr =
    `<w:sectPr>` +
    (landscape
      ? `<w:pgSz w:w="${page.width}" w:h="${page.height}" w:orient="landscape"/>`
      : `<w:pgSz w:w="${page.width}" w:h="${page.height}"/>`) +
    `<w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" w:left="${MARGIN_TWIPS}" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;

  return {
    '[Content_Types].xml': CONTENT_TYPES_XML.replace('</Types>', '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/></Types>'),
    '_rels/.rels': ROOT_RELS_XML,
    'word/_rels/document.xml.rels': DOCUMENT_RELS_XML.replace('</Relationships>', media.map(image => `<Relationship Id="image${image.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${image.id}.${image.extension}"/>`).join('') + '</Relationships>'),
    'word/document.xml': documentXml,
    'word/styles.xml': STYLES_XML,
    ...Object.fromEntries(media.map(image => [`word/media/image${image.id}.${image.extension}`, image.binary])),
  };
}

/** Zips the package parts into a .docx byte stream (valid OOXML container). */
export function buildDocxBytes(html: string, options: DocxExportOptions = {}): Uint8Array {
  const parts = buildDocxParts(html, options);
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(parts)) {
    entries[name] = name.startsWith('word/media/') ? Uint8Array.from(content, c => c.charCodeAt(0)) : strToU8(content);
  }
  return zipSync(entries, { level: 6 });
}

/** Browser download helper used by every export icon in the app. */
export async function exportHtmlToDocx(html: string, filename: string, options: DocxExportOptions = {}): Promise<void> {
  const prepared = await embedRemoteImages(html);
  const bytes = buildDocxBytes(prepared, options);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: DOCX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface EmbeddedImage { id: number; extension: 'png' | 'jpg'; binary: string }

function collectImages(nodes: HtmlNode[]): EmbeddedImage[] {
  const images: EmbeddedImage[] = [];
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.tag === 'img') {
        const match = /^data:image\/(png|jpeg|jpg);base64,([a-z0-9+/=\s]+)$/i.exec(node.attrs?.src || '');
        if (match) {
          const binary = atob(match[2].replace(/\s/g, ''));
          const id = images.length + 1;
          const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
          const widthPx = Math.max(1, Math.min(600, parseFloat(node.attrs?.width || '100') || 100));
          const heightPx = Math.max(1, Math.min(800, parseFloat(node.attrs?.height || '130') || 130));
          node.image = { id, width: Math.round(widthPx * 9525), height: Math.round(heightPx * 9525) };
          images.push({ id, extension, binary });
        }
      }
      walk(node.children || []);
    }
  };
  walk(nodes);
  return images;
}

/** Fetches signed avatar URLs into the package, so the photo is usable offline in Word. */
async function embedRemoteImages(html: string): Promise<string> {
  const sources = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => decodeHtmlEntities(match[1])))];
  for (const source of sources) {
    if (/^data:image\/(?:png|jpe?g);base64,/i.test(source)) continue;
    if (!/^(https?:|blob:|data:image\/|\/)/i.test(source)) continue;
    const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('تعذر تحميل الصورة المرفقة بالوثيقة. حاول التصدير مجدداً.');
    let blob = await response.blob();
    // Word universally supports PNG/JPEG. Convert WebP/GIF/AVIF avatars instead of silently
    // losing the photo that the profile upload control accepts as image/*.
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(blob.type.toLowerCase())) {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('تعذر تحويل الصورة للتصدير.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
        if (result) resolve(result); else reject(new Error('تعذر تحويل الصورة للتصدير.'));
      }, 'image/png'));
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const dataUrl = `data:${blob.type};base64,${btoa(binary)}`;
    html = html.replaceAll(source, dataUrl).replaceAll(source.replace(/&/g, '&amp;'), dataUrl);
  }
  return html;
}
