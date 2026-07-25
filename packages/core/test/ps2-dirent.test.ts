import { describe, expect, it } from "vitest";
import {
  isPs2DirMode,
  isPs2FileMode,
  packPs2Dirent,
  ps2DirMode,
  ps2FileMode,
  ps2TodFromDate,
  unpackPs2Dirent,
} from "../src/index";

describe("PS2 directory entries", async () => {
  it("round-trips the 512-byte PS2 memory-card directory entry layout", async () => {
    const created = ps2TodFromDate(new Date("2026-03-13T23:46:52Z"));
    const modified = ps2TodFromDate(new Date("2026-03-14T01:02:03Z"));
    const packed = packPs2Dirent({
      mode: ps2FileMode,
      unknown: 0,
      length: 0x1234,
      created,
      cluster: 7,
      parent: 2,
      modified,
      attr: 0,
      name: "icon.sys",
    });

    expect(packed).toHaveLength(512);
    expect(packed.readUInt16LE(0)).toBe(ps2FileMode);
    expect(packed.readUInt32LE(4)).toBe(0x1234);
    expect(packed.subarray(64, 512).toString("ascii").replace(/\0.*$/u, "")).toBe("icon.sys");

    const unpacked = unpackPs2Dirent(packed);
    expect(unpacked).toMatchObject({
      mode: ps2FileMode,
      length: 0x1234,
      created,
      cluster: 7,
      parent: 2,
      modified,
      attr: 0,
      name: "icon.sys",
    });
    expect(isPs2FileMode(unpacked.mode)).toBe(true);
    expect(isPs2DirMode(unpacked.mode)).toBe(false);
  });

  it("recognizes directory mode flags", async () => {
    expect(ps2DirMode).toBe(0x8427);
    expect(ps2FileMode).toBe(0x8417);
    expect(isPs2DirMode(ps2DirMode)).toBe(true);
    expect(isPs2FileMode(ps2FileMode)).toBe(true);
    expect(isPs2FileMode(ps2DirMode)).toBe(false);
  });
});
