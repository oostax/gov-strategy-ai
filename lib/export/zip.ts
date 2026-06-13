/**
 * Минимальный ZIP-энкодер по спецификации PKZIP (сохраняем файлы без сжатия,
 * method=0 — этого достаточно для валидного DOCX/PPTX).
 *
 * Используем CRC32 + little-endian заголовки. Сжатие (deflate) не используем,
 * потому что размеры документов небольшие, а это снимает зависимости и риск
 * несовместимости со средой Next.js Edge.
 */

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const TABLE = crc32Table();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}
function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

/**
 * Собирает ZIP-архив из массива записей.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data =
      typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(data);
    const size = data.length;

    // Local file header: 30 bytes fixed + filename
    const header = new Uint8Array(30 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    writeUint32LE(headerView, 0, 0x04034b50);
    writeUint16LE(headerView, 4, 20); // version
    writeUint16LE(headerView, 6, 0); // flags
    writeUint16LE(headerView, 8, 0); // method = store
    writeUint16LE(headerView, 10, 0); // mod time
    writeUint16LE(headerView, 12, 0); // mod date
    writeUint32LE(headerView, 14, crc);
    writeUint32LE(headerView, 18, size);
    writeUint32LE(headerView, 22, size);
    writeUint16LE(headerView, 26, nameBytes.length);
    writeUint16LE(headerView, 28, 0);
    header.set(nameBytes, 30);

    parts.push(header, data);

    // Central directory header: 46 bytes fixed + filename
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cd.buffer);
    writeUint32LE(cdView, 0, 0x02014b50);
    writeUint16LE(cdView, 4, 20);
    writeUint16LE(cdView, 6, 20);
    writeUint16LE(cdView, 8, 0);
    writeUint16LE(cdView, 10, 0);
    writeUint16LE(cdView, 12, 0);
    writeUint16LE(cdView, 14, 0);
    writeUint32LE(cdView, 16, crc);
    writeUint32LE(cdView, 20, size);
    writeUint32LE(cdView, 24, size);
    writeUint16LE(cdView, 28, nameBytes.length);
    writeUint16LE(cdView, 30, 0);
    writeUint16LE(cdView, 32, 0);
    writeUint16LE(cdView, 34, 0);
    writeUint16LE(cdView, 36, 0);
    writeUint32LE(cdView, 38, 0);
    writeUint32LE(cdView, 42, offset);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += header.length + data.length;
  }

  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32LE(eocdView, 0, 0x06054b50);
  writeUint16LE(eocdView, 4, 0);
  writeUint16LE(eocdView, 6, 0);
  writeUint16LE(eocdView, 8, entries.length);
  writeUint16LE(eocdView, 10, entries.length);
  writeUint32LE(eocdView, 12, centralSize);
  writeUint32LE(eocdView, 16, offset);
  writeUint16LE(eocdView, 20, 0);

  let total = 0;
  for (const p of parts) total += p.length;
  total += centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const c of central) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);
  return out;
}

/**
 * Минимальный XML-эскейпер для пользовательского текста внутри документа.
 */
export function xmlEscape(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
