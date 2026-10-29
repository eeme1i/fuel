import { describe, expect, it } from "vitest";
import { parseLatestOilBulletin } from "./providers";
import { parseWeeklyObservations } from "./validation";
import { excelDate, readSheet } from "./xlsx";

/** Builds an uncompressed zip; the reader ignores CRCs, so they are left at zero. */
function zip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name),
      data = encoder.encode(text);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(header.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

describe("xlsx reader", () => {
  it("reads a named sheet with shared strings and numbers", async () => {
    const xlsx = zip({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Other" sheetId="1" r:id="rId1"/><sheet name="Prices with taxes" sheetId="2" r:id="rId2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/sharedStrings.xml":
        "<sst><si><t>Date</t></si><si><r><t>FI_price</t></r><r><t>_with_tax_euro95</t></r></si></sst>",
      "xl/worksheets/sheet2.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="CG1" t="s"><v>1</v></c></row><row r="2"><c r="A2" s="4"><v>46293</v></c><c r="B2"/><c r="CG2"><v>2331.125</v></c></row></sheetData></worksheet>',
    });
    const rows = await readSheet(xlsx, "Prices with taxes");
    expect(rows).toEqual([
      { A: "Date", CG: "FI_price_with_tax_euro95" },
      { A: "46293", CG: "2331.125" },
    ]);
    expect(excelDate(46293)).toBe("2026-09-28");
  });
});

describe("Weekly Oil Bulletin", () => {
  it("reads Finland's latest week from the first sheet", async () => {
    const cell = (ref: string, value: number) =>
      `<c r="${ref}"><v>${value}</v></c>`;
    const strings = [
      "in EUR",
      "Euro-super 95  (I)",
      "Gas oil automobile",
      "Finland",
      "Estonia",
    ];
    const shared = (ref: string, text: string) =>
      `<c r="${ref}" t="s"><v>${strings.indexOf(text)}</v></c>`;
    const xlsx = zip({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${shared("A1", "in EUR")}${shared("B1", "Euro-super 95  (I)")}${shared("C1", "Gas oil automobile")}</row><row r="2">${cell("A2", 46293)}</row><row r="3">${shared("A3", "Estonia")}${cell("B3", 1928)}${cell("C3", 2239)}</row><row r="4">${shared("A4", "Finland")}${cell("B4", 2331.125)}${cell("C4", 2522.95)}</row></sheetData></worksheet>`,
    });
    expect(await parseLatestOilBulletin(xlsx)).toEqual([
      { fuel: "95E10", date: "2026-09-28", priceEurL: 2.331125 },
      { fuel: "DIESEL", date: "2026-09-28", priceEurL: 2.52295 },
    ]);
  });

  it("rejects weekly prices sent per 1000 L", () => {
    expect(
      parseWeeklyObservations({
        observations: [{ fuel: "95E10", date: "2026-09-28", priceEurL: 2331 }],
      }),
    ).toMatchObject({ error: "invalid_observation" });
    expect(
      parseWeeklyObservations({
        observations: [{ fuel: "diesel", date: "2026-09-28", priceEurL: 2.52 }],
      }),
    ).toEqual({
      value: [{ fuel: "DIESEL", date: "2026-09-28", priceEurL: 2.52 }],
    });
  });
});
