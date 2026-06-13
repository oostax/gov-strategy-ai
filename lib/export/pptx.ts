import type { AgentOutput } from "@/lib/schemas/output";
import { buildZip, xmlEscape } from "./zip";

/**
 * Минимальный генератор .pptx из AgentOutput. Слайды строятся из секций
 * output: заголовок секции → bullet-tezы (каждая строка секции = пункт).
 */

interface Slide {
  title: string;
  bullets: string[];
}

function splitBullets(text: string, limit = 7): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, limit);
}

function buildSlideXml(slide: Slide, slideIdx: number): string {
  const titleSafe = xmlEscape(slide.title || `Слайд ${slideIdx + 1}`);
  const bulletsXml = slide.bullets.length
    ? slide.bullets
        .map(
          (b) =>
            `<a:p><a:pPr lvl="0" indent="-228600"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="ru-RU" sz="1800" dirty="0"/><a:t>${xmlEscape(b)}</a:t></a:r></a:p>`,
        )
        .join("")
    : `<a:p><a:endParaRPr lang="ru-RU" sz="1800"/></a:p>`;

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
          <a:p><a:r><a:rPr lang="ru-RU" sz="3200" b="1"/><a:t>${titleSafe}</a:t></a:r></a:p>
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

export function buildPptx(output: AgentOutput, headerMeta: string[] = []): Uint8Array {
  const slides: Slide[] = [];
  slides.push({
    title: output.title || "Стратегический материал",
    bullets: [
      ...(headerMeta.length ? [headerMeta.join(" · ")] : []),
      ...splitBullets(output.summary, 6),
    ],
  });
  for (const s of output.sections) {
    slides.push({ title: s.title, bullets: splitBullets(s.content, 7) });
  }
  if (output.risks?.length) slides.push({ title: "Риски", bullets: output.risks.slice(0, 7) });
  if (output.nextSteps?.length)
    slides.push({ title: "Следующие шаги", bullets: output.nextSteps.slice(0, 7) });

  // Минимальные XML-подложки презентации
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
    entries.push({
      path: `ppt/slides/slide${idx + 1}.xml`,
      content: buildSlideXml(slide, idx),
    });
  });

  return buildZip(entries);
}
