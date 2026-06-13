import type { AgentOutput } from "@/lib/schemas/output";
import { buildZip, xmlEscape } from "./zip";

/**
 * Минимальный генератор .docx из AgentOutput. Никаких внешних зависимостей —
 * собираем OOXML пакет вручную. Word читает его полностью.
 */

function paragraph(text: string, style?: string): string {
  const safe = xmlEscape(text || " ");
  const pPr = style
    ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
    : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function listItem(text: string): string {
  const safe = xmlEscape(text || " ");
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function splitBullets(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0);
}

function section(title: string, body: string, asList = false): string {
  const head = paragraph(title, "Heading2");
  if (!body?.trim()) return head + paragraph(" ");
  if (asList) {
    const items = splitBullets(body);
    if (items.length) return head + items.map(listItem).join("");
  }
  return head + body
    .split(/\n+/)
    .map((line) => paragraph(line.trim()))
    .join("");
}

export function buildDocx(output: AgentOutput, headerMeta: string[] = []): Uint8Array {
  const bodyParts: string[] = [];
  bodyParts.push(paragraph(output.title || "Стратегический материал", "Title"));
  if (headerMeta.length) {
    bodyParts.push(paragraph(headerMeta.join(" · "), "Subtitle"));
  }
  bodyParts.push(section("Резюме", output.summary));
  if (output.recommendations?.length) {
    bodyParts.push(section("Ключевые рекомендации", output.recommendations.join("\n"), true));
  }
  for (const s of output.sections) {
    bodyParts.push(section(s.title, s.content, s.type !== "text"));
  }
  if (output.risks?.length) {
    bodyParts.push(section("Риски", output.risks.join("\n"), true));
  }
  if (output.nextSteps?.length) {
    bodyParts.push(section("Следующие шаги", output.nextSteps.join("\n"), true));
  }
  if (output.sources?.length) {
    const srcText = output.sources
      .map((src) => `${src.title}${src.url ? ` (${src.url})` : ""} — ${src.excerpt}`)
      .join("\n");
    bodyParts.push(section("Источники", srcText, true));
  }

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
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>
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
