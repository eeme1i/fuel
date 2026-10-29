/**
 * Minimal .xlsx reader: finds one worksheet in the zip and returns its cells as text. Enough for
 * the EU Weekly Oil Bulletin, which is only published as a spreadsheet. No dependencies, so it
 * runs in Workers and Node alike.
 */

async function inflateRaw(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads one file from a zip archive through its central directory (no ZIP64). */
export async function zipEntry(zip: Uint8Array<ArrayBuffer>, name: string) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  // The end-of-central-directory record is the last 22 bytes plus an optional comment.
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("not a zip archive");
  const decoder = new TextDecoder();
  let offset = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("corrupt zip central directory");
    const method = view.getUint16(offset + 10, true),
      compressedSize = view.getUint32(offset + 20, true),
      nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      commentLength = view.getUint16(offset + 32, true),
      local = view.getUint32(offset + 42, true);
    const entry = decoder.decode(
      zip.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (entry === name) {
      const start =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      const data = zip.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

const unescapeXml = (text: string) =>
  text.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) =>
    entity === "lt"
      ? "<"
      : entity === "gt"
        ? ">"
        : entity === "amp"
          ? "&"
          : entity === "quot"
            ? '"'
            : "'",
  );

async function zipText(zip: Uint8Array<ArrayBuffer>, name: string) {
  const data = await zipEntry(zip, name);
  return data && new TextDecoder().decode(data);
}

/**
 * Rows of the named worksheet (the first one by default), each mapping a column letter ("A",
 * "CG") to the cell's text. Shared strings are resolved; numbers, including date serials, stay
 * as their stored text.
 */
export async function readSheet(
  xlsx: Uint8Array<ArrayBuffer>,
  sheetName?: string,
) {
  const workbook = await zipText(xlsx, "xl/workbook.xml");
  const rels = await zipText(xlsx, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("not an xlsx workbook");
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map(([tag]) => ({
      name: unescapeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? ""),
      id: /\br:id="([^"]*)"/.exec(tag)?.[1],
    }))
    .find(
      (candidate) => sheetName === undefined || candidate.name === sheetName,
    );
  if (!sheet?.id) throw new Error(`worksheet "${sheetName ?? 1}" not found`);
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map(([tag]) => ({
      id: /\bId="([^"]*)"/.exec(tag)?.[1],
      target: /\bTarget="([^"]*)"/.exec(tag)?.[1],
    }))
    .find((rel) => rel.id === sheet.id)?.target;
  if (!target) throw new Error(`worksheet "${sheet.name}" has no part`);
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const xml = await zipText(xlsx, path);
  if (!xml) throw new Error(`worksheet part ${path} missing`);

  const shared = [
    ...((await zipText(xlsx, "xl/sharedStrings.xml")) ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map(([, item]) =>
    unescapeXml(
      [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map(([, t]) => t)
        .join(""),
    ),
  );
  const rows: Array<Record<string, string>> = [];
  for (const [, body] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Record<string, string> = {};
    for (const [, attributes, content] of body.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const column = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const value = content && /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
      if (!column || value === undefined) continue;
      const type = /\bt="([^"]*)"/.exec(attributes)?.[1];
      row[column] =
        type === "s" ? (shared[Number(value)] ?? "") : unescapeXml(value);
    }
    rows.push(row);
  }
  return rows;
}

/** Excel's 1900 date system, as an ISO date. */
export function excelDate(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
