import type { Buffer } from "buffer";

export class BinaryReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  tell(): number {
    return this.offset;
  }

  length(): number {
    return this.buffer.length;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.buffer.length) {
      throw new RangeError(`Seek out of bounds: ${offset}`);
    }

    this.offset = offset;
  }

  skip(length: number): void {
    this.seek(this.offset + length);
  }

  readUInt8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt16LE(): number {
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readInt32LE(): number {
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Buffer {
    const end = this.offset + length;
    if (end > this.buffer.length) {
      throw new RangeError(`Read out of bounds: ${end}`);
    }

    const value = this.buffer.subarray(this.offset, end);
    this.offset = end;
    return value;
  }
}
