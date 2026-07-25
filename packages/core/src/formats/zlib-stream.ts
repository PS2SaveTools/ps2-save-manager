import { Buffer } from "buffer";

function adler32(input: Buffer): number {
  let a = 1;
  let b = 0;

  for (const byte of input) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  return ((b << 16) | a) >>> 0;
}

export function zlibStore(input: Buffer): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x78, 0x01])];

  for (let offset = 0; offset < input.length || offset === 0; offset += 0xffff) {
    const end = Math.min(input.length, offset + 0xffff);
    const block = input.subarray(offset, end);
    const header = Buffer.alloc(5);
    header.writeUInt8(end >= input.length ? 0x01 : 0x00, 0);
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE((~block.length) & 0xffff, 3);
    chunks.push(header, block);

    if (input.length === 0) {
      break;
    }
  }

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(input), 0);
  chunks.push(checksum);
  return Buffer.concat(chunks);
}

export async function zlibInflate(input: Buffer): Promise<Buffer> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("CBS zlib decompression is not supported by this runtime");
  }

  const stream = new Blob([Uint8Array.from(input)]).stream().pipeThrough(new DecompressionStream("deflate"));
  return Buffer.from(await new Response(stream).arrayBuffer());
}
