import { Buffer } from "buffer";

export class BinaryWriter {
  private buffer = Buffer.allocUnsafe(256);
  private offset = 0;

  private ensureCapacity(additionalBytes: number): void {
    const required = this.offset + additionalBytes;
    if (required <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < required) capacity *= 2;
    const grown = Buffer.allocUnsafe(capacity);
    this.buffer.copy(grown, 0, 0, this.offset);
    this.buffer = grown;
  }

  writeUInt8(value: number): this {
    this.ensureCapacity(1);
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
    return this;
  }

  writeUInt16LE(value: number): this {
    this.ensureCapacity(2);
    this.buffer.writeUInt16LE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeInt32LE(value: number): this {
    this.ensureCapacity(4);
    this.buffer.writeInt32LE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeBytes(value: Buffer): this {
    this.ensureCapacity(value.length);
    value.copy(this.buffer, this.offset);
    this.offset += value.length;
    return this;
  }

  length(): number { return this.offset; }

  toBuffer(): Buffer { return Buffer.from(this.buffer.subarray(0, this.offset)); }
}
