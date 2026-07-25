import type { Buffer } from "buffer";

// Shift-JIS words as stored in icon.sys, read as little-endian (so SJIS 0x8140
// reads as 0x4081), mapped to ASCII. Ported from TMaxSave.ShiftJistoAscii in
// maxFormat.pas, including its workarounds for icon.sys files produced by
// faulty tools (0x0081 and 0x3f82 both decode to a space).
const SJIS_PUNCTUATION: Record<number, string> = {
  0x4081: " ",
  0x4981: "!",
  0x6881: '"',
  0x9481: "#",
  0x9081: "$",
  0x9381: "%",
  0x9581: "&",
  0xad81: "'",
  0x6981: "(",
  0x6a81: ")",
  0x7b81: "+",
  0x4181: ",",
  0x7c81: "-",
  0x4281: ".",
  0x4681: ":",
  0x4781: ";",
  0x8381: "<",
  0x8181: "=",
  0x8481: ">",
  0x9781: "@",
  0x6d81: "[",
  0x8f81: "\\",
  0x6e81: "]",
  0x4f81: "^",
  0x5181: "_",
  0x4d81: "`",
  0x6f81: "{",
  0x6281: "|",
  0x7081: "}",
  0x6081: "~",
  0x0081: " ",
  0x3f82: " ",
};

export function shiftJisWordToAscii(word: number): string {
  if (word === 0x0000) {
    return "\0";
  }

  const punctuation = SJIS_PUNCTUATION[word];
  if (punctuation !== undefined) {
    return punctuation;
  }

  if ((word & 0xff) === 0x82) {
    const high = word >> 8;
    if (high >= 0x4f && high <= 0x58) {
      return String.fromCharCode(0x30 + high - 0x4f);
    }
    if (high >= 0x60 && high <= 0x79) {
      return String.fromCharCode(0x41 + high - 0x60);
    }
    if (high >= 0x81 && high <= 0x9a) {
      return String.fromCharCode(0x61 + high - 0x81);
    }
  }

  return "?";
}

export function decodeSjisTitle(raw: Buffer): string {
  let output = "";

  for (let offset = 0; offset + 1 < raw.length; offset += 2) {
    const character = shiftJisWordToAscii(raw.readUInt16LE(offset));
    if (character === "\0") {
      break;
    }
    output += character;
  }

  return output;
}

export function asciiToShiftJisWord(character: string): number {
  const code = character.charCodeAt(0);
  if (code === 0x20) return 0x4081;
  if (code >= 0x30 && code <= 0x39) return ((0x4f + code - 0x30) << 8) | 0x82;
  if (code >= 0x41 && code <= 0x5a) return ((0x60 + code - 0x41) << 8) | 0x82;
  if (code >= 0x61 && code <= 0x7a) return ((0x81 + code - 0x61) << 8) | 0x82;
  for (const [word, value] of Object.entries(SJIS_PUNCTUATION)) if (value === character) return Number(word);
  // '*', '/' and '?' are banned, and all unsupported input is encoded as
  // the canonical Shift-JIS space used by the original converter.
  return 0x4081;
}
