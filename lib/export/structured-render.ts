import puppeteer from "puppeteer";
import { buildZip, xmlEscape } from "./zip";
import type { DocBlock, DocModel, DocSection } from "./structured-doc";

/**
 * Рендер DocModel (обобщённая модель структурированного вывода) в docx / pptx / pdf.
 * Собираем OOXML вручную — как в docx.ts / pptx.ts, но с поддержкой настоящих таблиц.
 */

// ── DOCX ─────────────────────────────────────────────────────────────────────

function docxParagraph(text: string, style?: string): string {
  const safe = xmlEscape(text || " ");
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function docxListItem(text: string): string {
  const safe = xmlEscape(text || " ");
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function docxTableCell(text: string, header: boolean): string {
  const safe = xmlEscape(text || " ");
  const shd = header ? `<w:shd w:val="clear" w:color="auto" w:fill="EEF2F7"/>` : "";
  const runPr = header ? `<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>` : `<w:rPr><w:sz w:val="18"/></w:rPr>`;
  return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4" w:color="D0D5DD"/><w:left w:val="single" w:sz="4" w:color="D0D5DD"/><w:bottom w:val="single" w:sz="4" w:color="D0D5DD"/><w:right w:val="single" w:sz="4" w:color="D0D5DD"/></w:tcBorders>${shd}</w:tcPr><w:p><w:r>${runPr}<w:t xml:space="preserve">${safe}</w:t></w:r></w:p></w:tc>`;
}

function docxTableRow(cells: string[], header: boolean): string {
  const trPr = header ? `<w:trPr><w:tblHeader/></w:trPr>` : "";
  return `<w:tr>${trPr}${cells.map((c) => docxTableCell(c, header)).join("")}</w:tr>`;
}

function docxTable(headers: string[], rows: string[][]): string {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const width = Math.floor(9600 / colCount);
  const grid = Array.from({ length: colCount }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const pad = (cells: string[]) => {
    const out = cells.slice(0, colCount);
    while (out.length < colCount) out.push("");
    return out;
  };
  const headerRow = headers.length ? docxTableRow(pad(headers), true) : "";
  const bodyRows = rows.map((r) => docxTableRow(pad(r), false)).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9600" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>${docxParagraph(" ")}`;
}

function docxBlock(block: DocBlock): string {
  if (block.kind === "table") return docxTable(block.headers, block.rows);
  if (block.bullet) return block.lines.map(docxListItem).join("");
  return block.lines.map((line) => docxParagraph(line)).join("");
}

function docxSection(section: DocSection): string {
  const head = docxParagraph(section.heading, "Heading2");
  const note = section.note ? docxParagraph(section.note, "SectionNote") : "";
  const body = section.blocks.map(docxBlock).join("");
  return head + note + body;
}

export function buildStructuredDocx(model: DocModel): Uint8Array {
  const bodyParts: string[] = [];
  bodyParts.push(docxParagraph(model.title || "Стратегический материал", "Title"));
  if (model.subtitle) bodyParts.push(docxParagraph(model.subtitle, "Subtitle"));
  for (const section of model.sections) bodyParts.push(docxSection(section));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParts.join("")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:sz w:val="44"/><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="22"/><w:color w:val="777777"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:spacing w:before="320" w:after="120"/></w:pPr><w:rPr><w:sz w:val="28"/><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="SectionNote"><w:name w:val="Section Note"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="18"/><w:i/><w:color w:val="777777"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D5DD"/><w:left w:val="single" w:sz="4" w:color="D0D5DD"/><w:bottom w:val="single" w:sz="4" w:color="D0D5DD"/><w:right w:val="single" w:sz="4" w:color="D0D5DD"/><w:insideH w:val="single" w:sz="4" w:color="D0D5DD"/><w:insideV w:val="single" w:sz="4" w:color="D0D5DD"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  return buildZip([
    { path: "[Content_Types].xml", content: contentTypes },
    { path: "_rels/.rels", content: rels },
    { path: "word/_rels/document.xml.rels", content: documentRels },
    { path: "word/document.xml", content: documentXml },
    { path: "word/styles.xml", content: stylesXml },
    { path: "word/numbering.xml", content: numberingXml },
  ]);
}

// ── PPTX ─────────────────────────────────────────────────────────────────────

interface Slide {
  title: string;
  bullets: string[];
}

/** Разворачивает секцию в bullet-строки слайда: абзацы как есть, таблица — по строкам. */
function sectionToBullets(section: DocSection): string[] {
  const out: string[] = [];
  if (section.note) out.push(section.note);
  for (const block of section.blocks) {
    if (block.kind === "paragraphs") {
      out.push(...block.lines);
    } else {
      for (const row of block.rows) {
        const cells = row
          .map((cell, idx) => {
            const value = (cell ?? "").trim();
            if (!value) return "";
            const label = (block.headers[idx] ?? "").trim();
            return label ? `${label}: ${value}` : value;
          })
          .filter(Boolean);
        if (cells.length) out.push(cells.join(" · "));
      }
    }
  }
  return out.filter((line) => line && line.trim().length > 0);
}

function buildSlideXml(slide: Slide, slideIdx: number): string {
  const titleSafe = xmlEscape(slide.title || `Слайд ${slideIdx + 1}`);
  const bulletsXml = slide.bullets.length
    ? slide.bullets
        .map(
          (b) =>
            `<a:p><a:pPr lvl="0" indent="-228600"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="ru-RU" sz="1400" dirty="0"/><a:t>${xmlEscape(b)}</a:t></a:r></a:p>`,
        )
        .join("")
    : `<a:p><a:endParaRPr lang="ru-RU" sz="1400"/></a:p>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="365125"/><a:ext cx="8229600" cy="800000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:rPr lang="ru-RU" sz="2800" b="1"/><a:t>${titleSafe}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="1300000"/><a:ext cx="8229600" cy="5000000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          ${bulletsXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

export function buildStructuredPptx(model: DocModel): Uint8Array {
  const slides: Slide[] = [];
  slides.push({
    title: model.title || "Стратегический материал",
    bullets: model.subtitle ? [model.subtitle] : [],
  });
  for (const section of model.sections) {
    const bullets = sectionToBullets(section);
    // Разбиваем длинные секции на несколько слайдов по 8 пунктов.
    if (bullets.length <= 8) {
      slides.push({ title: section.heading, bullets });
    } else {
      for (let i = 0; i < bullets.length; i += 8) {
        const part = bullets.slice(i, i + 8);
        const suffix = i === 0 ? "" : ` (${Math.floor(i / 8) + 1})`;
        slides.push({ title: `${section.heading}${suffix}`, bullets: part });
      }
    }
  }

  const slideRels = slides
    .map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`,
    )
    .join("");

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldIdLst>
    ${slides.map((_, idx) => `<p:sldId id="${256 + idx}" r:id="rId${idx + 1}"/>`).join("")}
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideRels}
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slides
    .map(
      (_, idx) =>
        `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

  const entries = [
    { path: "[Content_Types].xml", content: contentTypes },
    { path: "_rels/.rels", content: rootRels },
    { path: "ppt/presentation.xml", content: presentationXml },
    { path: "ppt/_rels/presentation.xml.rels", content: presentationRels },
  ];
  slides.forEach((slide, idx) => {
    entries.push({ path: `ppt/slides/slide${idx + 1}.xml`, content: buildSlideXml(slide, idx) });
  });

  return buildZip(entries);
}

// ── PDF (через HTML + puppeteer) ──────────────────────────────────────────────

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBlock(block: DocBlock): string {
  if (block.kind === "table") {
    const head = block.headers.length
      ? `<thead><tr>${block.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`
      : "";
    const body = block.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
      .join("");
    return `<table>${head}<tbody>${body}</tbody></table>`;
  }
  if (block.bullet) {
    return `<ul>${block.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
  }
  return block.lines.map((line) => `<p>${esc(line)}</p>`).join("");
}

export function buildStructuredHtml(model: DocModel): string {
  const sections = model.sections
    .map(
      (section) => `<section class="block">
        <h2>${esc(section.heading)}</h2>
        ${section.note ? `<p class="note">${esc(section.note)}</p>` : ""}
        ${section.blocks.map(htmlBlock).join("")}
      </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Inter, Arial, sans-serif; color: #111; background: #fff; font-size: 11px; line-height: 1.45; }
    .eyebrow { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    h1 { font-size: 24px; margin: 6px 0 4px; }
    h2 { font-size: 15px; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
    p { margin: 0 0 6px; }
    p.note { color: #6b7280; font-style: italic; margin-top: -2px; }
    ul { margin: 0 0 8px; padding-left: 18px; }
    li { margin: 2px 0; }
    .block { page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 10px; }
    th, td { border: 1px solid #d0d5dd; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #eef2f7; font-weight: 700; }
    .hero { border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; background: linear-gradient(135deg,#f8fafc,#fff); margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="hero">
    ${model.subtitle ? `<div class="eyebrow">${esc(model.subtitle)}</div>` : ""}
    <h1>${esc(model.title)}</h1>
  </div>
  ${sections}
</body>
</html>`;
}

export async function buildStructuredPdf(model: DocModel): Promise<Uint8Array> {
  const html = buildStructuredHtml(model);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.pdf({ format: "A4", printBackground: true });
    return new Uint8Array(buffer);
  } finally {
    await browser.close();
  }
}
