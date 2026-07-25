import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import {
  ExportService,
  SaveInspectionService,
  type AppSaveDocument,
  type ExportFormat,
} from "../src/index";

function syntheticPs2Save(): AppSaveDocument {
  const timestamp = new Date("2026-01-01T00:00:00Z");
  const data = Buffer.from("PS2 Save Manager synthetic fixture", "utf8");

  return {
    id: "synthetic-ps2",
    sourceFormat: "new",
    type: "ps2",
    displayName: "Synthetic Save",
    dirName: "BASLUS-00000SYNTH",
    rootMode: 0x8427,
    entryCount: 1,
    entries: [
      {
        id: "synthetic-data",
        name: "DATA.BIN",
        data,
        attribute: 0x8497,
        mode: 0x8497,
        createdAt: timestamp,
        modifiedAt: timestamp,
      },
    ],
    metadata: {},
    rawInput: Buffer.alloc(0),
    edited: true,
  };
}

describe("public synthetic round trips", () => {
  it("round-trips every supported PS2 export format without private fixtures", async () => {
    const source = syntheticPs2Save();
    const exporter = new ExportService();
    const inspector = new SaveInspectionService();
    const formats: ExportFormat[] = [
      "psv",
      "max",
      "pws",
      "psu",
      "xps",
      "sps",
      "xpo",
      "spo",
      "cbs",
      "npo",
      "md",
      "p2m",
    ];

    for (const format of formats) {
      const exported = exporter.export(source, format);
      const parsed = await inspector.inspectBuffer(exported.data, exported.fileName);

      expect(parsed.type, format).toBe("ps2");
      expect(parsed.dirName, format).toBe(source.dirName);
      expect(parsed.entries.map((entry) => entry.name), format).toEqual(["DATA.BIN"]);
      expect(parsed.entries[0]!.data.equals(source.entries[0]!.data), format).toBe(true);
    }
  });
});
