const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  CRC_TABLE[index] = value >>> 0;
}

export function crc32(buffer: Buffer): number {
  let result = 0xffffffff;

  for (const byte of buffer) {
    result = (result >>> 8) ^ CRC_TABLE[(result ^ byte) & 0xff]!;
  }

  return (~result) >>> 0;
}
