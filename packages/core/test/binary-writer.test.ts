import { describe, expect, it } from "vitest";
import { BinaryWriter } from "../src/index";

describe("BinaryWriter", () => {
  it("grows without changing written bytes or length", () => {
    const writer = new BinaryWriter();
    for (let value = 0; value < 1_000; value += 1) writer.writeUInt8(value & 0xff);
    writer.writeUInt16LE(0x1234).writeInt32LE(-123456).writeBytes(Buffer.alloc(600, 0xaa));

    const output = writer.toBuffer();
    expect(writer.length()).toBe(1_606);
    expect(output.length).toBe(writer.length());
    expect(output.subarray(0, 4)).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(output.readUInt16LE(1_000)).toBe(0x1234);
    expect(output.readInt32LE(1_002)).toBe(-123456);
    expect(output.subarray(1_006).equals(Buffer.alloc(600, 0xaa))).toBe(true);
  });
});
