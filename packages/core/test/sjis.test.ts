import { describe, expect, it } from "vitest";
import { asciiToShiftJisWord } from "../src/index";

describe("ASCII to Shift-JIS conversion", async () => {
  it.each(["*", "/", "?"])("encodes banned character %s as the canonical space", (character) => {
    expect(asciiToShiftJisWord(character)).toBe(0x4081);
  });

  it("encodes unsupported input as the canonical space", async () => {
    expect(asciiToShiftJisWord("é")).toBe(0x4081);
  });

  it("preserves representative supported mappings", async () => {
    expect(asciiToShiftJisWord(" ")).toBe(0x4081);
    expect(asciiToShiftJisWord("0")).toBe(0x4f82);
    expect(asciiToShiftJisWord("A")).toBe(0x6082);
    expect(asciiToShiftJisWord("a")).toBe(0x8182);
    expect(asciiToShiftJisWord("~")).toBe(0x6081);
  });
});
