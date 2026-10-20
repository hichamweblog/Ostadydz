import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync } from 'fflate';

import {
  DOCX_MIME_TYPE,
  buildDocxBytes,
  buildDocxParts,
  parseHtml,
} from '@/lib/docx-exporter';

const SAMPLE_HTML = `
<html dir="rtl">
<head><meta charset="utf-8"><title>دفتر النصوص</title>
<style>@page { size: A4; }</style>
</head>
<body>
  <h1 style="text-align:center;">الجمهورية الجزائرية الديمقراطية الشعبية</h1>
  <h2>دفتر النصوص — قسم 1AS1</h2>
  <p>الفقرة الأولى مع <strong>نص عريض</strong> و<em>نص مائل</em> ولون <span style="color:#dc2626;">أحمر</span>.</p>
  <ul><li>نقطة أولى</li><li>نقطة ثانية</li></ul>
  <table>
    <tr><th style="background-color:#e8f4f0;">التاريخ</th><th>الموضوع</th></tr>
    <tr><td>2026-10-04</td><td>تقديم توجيهات عامة</td></tr>
    <tr><td colspan="2">ملاحظة مدمجة</td></tr>
  </table>
  <hr/>
  <div style="text-align:center;">تذييل الصفحة</div>
</body>
</html>`;

function documentXml(html: string, options: { landscape?: boolean } = {}): string {
  return buildDocxParts(html, options)['word/document.xml'];
}

describe('HTML parsing', () => {
  it('builds a tree and skips head/style content', () => {
    const tree = parseHtml(SAMPLE_HTML);
    const tags = JSON.stringify(tree);
    expect(tags).not.toContain('@page');
    expect(tags).toContain('h1');
    expect(tags).toContain('table');
  });

  it('parses attributes including style and colspan', () => {
    const tree = parseHtml('<table><tr><td colspan="2" style="background-color:#fff;">x</td></tr></table>');
    const table = tree[0];
    const row = table.children?.[0];
    const cell = row?.children?.[0];
    expect(cell?.attrs?.colspan).toBe('2');
    expect(cell?.attrs?.style).toContain('background-color');
  });
});

describe('WordprocessingML generation', () => {
  const xml = documentXml(SAMPLE_HTML);

  it('declares an A4 portrait page with RTL section', () => {
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('<w:pgMar');
  });

  it('uses RTL paragraphs with right alignment by default and centred headings', () => {
    expect(xml).toContain('<w:pPr><w:bidi/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:jc w:val="right"/>');
  });

  it('maps bold/italic/colour runs', () => {
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:color w:val="DC2626"/>');
    expect(xml).toContain('نص عريض');
  });

  it('maps tables with bidiVisual, borders, header shading and colspan', () => {
    expect(xml).toContain('<w:bidiVisual/>');
    expect(xml).toContain('<w:tblBorders>');
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="E8F4F0"/>');
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('تقديم توجيهات عامة');
  });

  it('maps lists to indented bullet paragraphs and hr to a bordered paragraph', () => {
    expect(xml).toContain('• ');
    expect(xml).toContain('نقطة أولى');
    expect(xml).toContain('<w:ind w:right="284"/>');
    expect(xml).toContain('<w:pBdr>');
  });

  it('supports landscape pages', () => {
    const landscape = documentXml(SAMPLE_HTML, { landscape: true });
    expect(landscape).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
  });

  it('escapes XML special characters in text', () => {
    const escaped = documentXml('<p>5 &lt; 6 &amp; 7 &gt; 2</p>');
    expect(escaped).toContain('5 &lt; 6 &amp; 7 &gt; 2');
  });
});

describe('.docx package', () => {
  it('contains every required OOXML part', () => {
    const parts = buildDocxParts(SAMPLE_HTML);
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
    expect(parts['[Content_Types].xml']).toContain('wordprocessingml.document.main+xml');
    expect(parts['word/styles.xml']).toContain('<w:bidi/>');
  });

  it('zips into a valid container readable back with fflate', () => {
    const bytes = buildDocxBytes(SAMPLE_HTML);
    // ZIP local file header magic
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);
    expect(names).toContain('word/document.xml');
    const doc = new TextDecoder().decode(entries['word/document.xml']);
    expect(doc).toContain('<w:document');
    expect(doc).toContain('<w:bidi/>');
  });

  it('exposes the official OOXML mime type', () => {
    expect(DOCX_MIME_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(strToU8('x')).toHaveLength(1);
  });
});


describe('real export templates: nested layout, entities and photographs', () => {
  it('keeps nested tables intact, within the available A4 cell width', () => {
    const xml = documentXml('<table><tr><td style="width:68%"><table><tr><td>الاسم</td><td>الأستاذ</td></tr></table></td><td>الصورة</td></tr></table>');
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml).toContain('الأستاذ');
    expect(xml).toContain('<w:bidiVisual/>');
  });
  it('decodes Arabic numeric entities once, without double XML escaping', () => {
    const xml = documentXml('<p>&#1571;&#x633;&#1578;&#1575;&#1584; &amp; &nbsp;</p>');
    expect(xml).toContain('أستاذ');
    expect(xml).not.toContain('&amp;amp;');
  });
  it('embeds a portrait image with a package relationship instead of discarding it', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bJAAAAAASUVORK5CYII=';
    const bytes = buildDocxBytes(`<table><tr><td><img src="data:image/png;base64,${png}" width="100" height="130" /></td></tr></table>`);
    const entries = unzipSync(bytes);
    expect(entries['word/media/image1.png']).toBeDefined();
    expect([...entries['word/media/image1.png'].slice(0, 4)]).toEqual([137, 80, 78, 71]);
    const doc = new TextDecoder().decode(entries['word/document.xml']);
    const rels = new TextDecoder().decode(entries['word/_rels/document.xml.rels']);
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('r:embed="image1"');
    expect(rels).toContain('media/image1.png');
  });
  it('inherits alignment and preserves table header repetition across pages', () => {
    const xml = documentXml('<div style="text-align:center"><p>عنوان</p></div><table><tr><th>التاريخ</th></tr><tr><td>نص</td></tr></table>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:tblHeader/>');
  });
});
