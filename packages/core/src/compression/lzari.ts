import { Buffer } from "buffer";

const N = 4096;
const F = 60;
const THRESHOLD = 2;
const M = 15;
const Q1 = 1 << M;
const Q2 = 2 * Q1;
const Q3 = 3 * Q1;
const Q4 = 4 * Q1;
const MAX_CUM = Q1 - 1;
const N_CHAR = 256 - THRESHOLD + F;

class BitReader {
  private offset = 0;
  private buffer = 0;
  private mask = 0;

  constructor(private readonly input: Buffer) {}

  getBit(): number {
    this.mask >>= 1;

    if (this.mask === 0) {
      if (this.offset >= this.input.length) {
        this.buffer = 0;
      } else {
        this.buffer = this.input[this.offset] ?? 0;
        this.offset += 1;
      }

      this.mask = 128;
    }

    return (this.buffer & this.mask) !== 0 ? 1 : 0;
  }
}

class BitWriter {
  private readonly chunks: number[] = [];
  private buffer = 0;
  private mask = 128;

  putBit(bit: number): void {
    if (bit !== 0) {
      this.buffer |= this.mask;
    }

    this.mask >>= 1;

    if (this.mask === 0) {
      this.chunks.push(this.buffer);
      this.buffer = 0;
      this.mask = 128;
    }
  }

  flush(): void {
    for (let index = 0; index < 7; index += 1) {
      this.putBit(0);
    }
  }

  toBuffer(): Buffer {
    return Buffer.from(this.chunks);
  }
}

class LzariDecoder {
  private readonly textBuffer = new Uint8Array(N + F - 1);
  private readonly charToSym = new Int32Array(N_CHAR);
  private readonly symToChar = new Int32Array(N_CHAR + 1);
  private readonly symFreq = new Int32Array(N_CHAR + 1);
  private readonly symCum = new Int32Array(N_CHAR + 1);
  private readonly positionCum = new Int32Array(N + 1);

  private low = 0;
  private high = Q4;
  private value = 0;

  constructor(private readonly bits: BitReader) {}

  decode(outputLength: number): Buffer {
    const output = Buffer.alloc(outputLength);

    this.startDecode();
    this.startModel();

    for (let index = 0; index < N - F; index += 1) {
      this.textBuffer[index] = 0x20;
    }

    let r = N - F;
    let count = 0;

    while (count < outputLength) {
      let c = this.decodeChar();

      if (c < 256) {
        output[count] = c;
        this.textBuffer[r] = c;
        r = (r + 1) & (N - 1);
        count += 1;
        continue;
      }

      const i = (r - this.decodePosition() - 1) & (N - 1);
      const length = c - 255 + THRESHOLD;

      for (let k = 0; k < length && count < outputLength; k += 1) {
        c = this.textBuffer[(i + k) & (N - 1)] ?? 0;
        output[count] = c;
        this.textBuffer[r] = c;
        r = (r + 1) & (N - 1);
        count += 1;
      }
    }

    return output;
  }

  private startDecode(): void {
    for (let i = 0; i < M + 2; i += 1) {
      this.value = 2 * this.value + this.bits.getBit();
    }
  }

  private startModel(): void {
    this.symCum[N_CHAR] = 0;

    for (let sym = N_CHAR; sym >= 1; sym -= 1) {
      const ch = sym - 1;
      this.charToSym[ch] = sym;
      this.symToChar[sym] = ch;
      this.symFreq[sym] = 1;
      this.symCum[sym - 1] = this.symCum[sym] + this.symFreq[sym];
    }

    this.symFreq[0] = 0;
    this.positionCum[N] = 0;

    for (let i = N; i >= 1; i -= 1) {
      this.positionCum[i - 1] = Math.trunc(this.positionCum[i] + 10000 / (i + 200));
    }
  }

  private decodeChar(): number {
    const range = this.high - this.low;
    const scaled = Math.trunc((((this.value - this.low + 1) * this.symCum[0]) - 1) / range);
    const sym = this.binarySearchSym(scaled);

    this.high = Math.trunc(this.low + (range * this.symCum[sym - 1]) / this.symCum[0]);
    this.low = Math.trunc(this.low + (range * this.symCum[sym]) / this.symCum[0]);

    while (true) {
      if (this.low >= Q2) {
        this.value -= Q2;
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.value -= Q1;
        this.low -= Q1;
        this.high -= Q1;
      } else if (this.high > Q2) {
        break;
      }

      this.low += this.low;
      this.high += this.high;
      this.value = 2 * this.value + this.bits.getBit();
    }

    const ch = this.symToChar[sym];
    this.updateModel(sym);
    return ch;
  }

  private decodePosition(): number {
    const range = this.high - this.low;
    const scaled = Math.trunc((((this.value - this.low + 1) * this.positionCum[0]) - 1) / range);
    const position = this.binarySearchPos(scaled);

    this.high = Math.trunc(this.low + (range * this.positionCum[position]) / this.positionCum[0]);
    this.low = Math.trunc(this.low + (range * this.positionCum[position + 1]) / this.positionCum[0]);

    while (true) {
      if (this.low >= Q2) {
        this.value -= Q2;
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.value -= Q1;
        this.low -= Q1;
        this.high -= Q1;
      } else if (this.high > Q2) {
        break;
      }

      this.low += this.low;
      this.high += this.high;
      this.value = 2 * this.value + this.bits.getBit();
    }

    return position;
  }

  private binarySearchSym(x: number): number {
    let i = 1;
    let j = N_CHAR;

    while (i < j) {
      const k = Math.trunc((i + j) / 2);
      if ((this.symCum[k] ?? 0) > x) {
        i = k + 1;
      } else {
        j = k;
      }
    }

    return i;
  }

  private binarySearchPos(x: number): number {
    let i = 1;
    let j = N;

    while (i < j) {
      const k = Math.trunc((i + j) / 2);
      if ((this.positionCum[k] ?? 0) > x) {
        i = k + 1;
      } else {
        j = k;
      }
    }

    return i - 1;
  }

  private updateModel(sym: number): void {
    if (this.symCum[0] >= MAX_CUM) {
      let c = 0;
      for (let i = N_CHAR; i >= 1; i -= 1) {
        this.symCum[i] = c;
        this.symFreq[i] = (this.symFreq[i] + 1) >> 1;
        c += this.symFreq[i];
      }
      this.symCum[0] = c;
    }

    let i = sym;
    while (this.symFreq[i] === this.symFreq[i - 1]) {
      i -= 1;
    }

    if (i < sym) {
      const chI = this.symToChar[i];
      const chSym = this.symToChar[sym];
      this.symToChar[i] = chSym;
      this.symToChar[sym] = chI;
      this.charToSym[chI] = sym;
      this.charToSym[chSym] = i;
    }

    this.symFreq[i] += 1;
    i -= 1;

    while (i >= 0) {
      this.symCum[i] += 1;
      i -= 1;
    }
  }
}

class LzariEncoder {
  private readonly textBuffer = new Uint8Array(N + F - 1);
  private readonly lson = new Int32Array(N + 1);
  private readonly rson = new Int32Array(N + 257);
  private readonly dad = new Int32Array(N + 1);
  private readonly charToSym = new Int32Array(N_CHAR);
  private readonly symToChar = new Int32Array(N_CHAR + 1);
  private readonly symFreq = new Int32Array(N_CHAR + 1);
  private readonly symCum = new Int32Array(N_CHAR + 1);
  private readonly positionCum = new Int32Array(N + 1);
  private readonly bits = new BitWriter();

  private low = 0;
  private high = Q4;
  private shifts = 0;
  private matchPosition = 0;
  private matchLength = 0;

  encode(input: Buffer): Buffer {
    if (input.length === 0) {
      return Buffer.alloc(0);
    }

    this.startModel();
    this.initTree();

    let s = 0;
    let r = N - F;
    for (let index = s; index < r; index += 1) {
      this.textBuffer[index] = 0x20;
    }

    let inputOffset = 0;
    let len = 0;
    for (; len < F && inputOffset < input.length; len += 1, inputOffset += 1) {
      this.textBuffer[r + len] = input[inputOffset] ?? 0;
    }

    for (let index = 1; index <= F; index += 1) {
      this.insertNode(r - index);
    }
    this.insertNode(r);

    do {
      if (this.matchLength > len) {
        this.matchLength = len;
      }

      if (this.matchLength <= THRESHOLD) {
        this.matchLength = 1;
        this.encodeChar(this.textBuffer[r] ?? 0);
      } else {
        this.encodeChar(255 - THRESHOLD + this.matchLength);
        this.encodePosition(this.matchPosition - 1);
      }

      const lastMatchLength = this.matchLength;
      let index = 0;

      for (; index < lastMatchLength && inputOffset < input.length; index += 1, inputOffset += 1) {
        const c = input[inputOffset] ?? 0;
        this.deleteNode(s);
        this.textBuffer[s] = c;
        if (s < F - 1) {
          this.textBuffer[s + N] = c;
        }
        s = (s + 1) & (N - 1);
        r = (r + 1) & (N - 1);
        this.insertNode(r);
      }

      while (index < lastMatchLength) {
        index += 1;
        this.deleteNode(s);
        s = (s + 1) & (N - 1);
        r = (r + 1) & (N - 1);
        len -= 1;
        if (len >= 1) {
          this.insertNode(r);
        }
      }
    } while (len > 0);

    this.encodeEnd();
    return this.bits.toBuffer();
  }

  private startModel(): void {
    this.symCum[N_CHAR] = 0;

    for (let sym = N_CHAR; sym >= 1; sym -= 1) {
      const ch = sym - 1;
      this.charToSym[ch] = sym;
      this.symToChar[sym] = ch;
      this.symFreq[sym] = 1;
      this.symCum[sym - 1] = this.symCum[sym] + this.symFreq[sym];
    }

    this.symFreq[0] = 0;
    this.positionCum[N] = 0;

    for (let index = N; index >= 1; index -= 1) {
      this.positionCum[index - 1] = Math.trunc(this.positionCum[index] + 10000 / (index + 200));
    }
  }

  private initTree(): void {
    for (let index = N + 1; index <= N + 256; index += 1) {
      this.rson[index] = N;
    }
    for (let index = 0; index < N; index += 1) {
      this.dad[index] = N;
    }
  }

  private insertNode(r: number): void {
    let cmp = 1;
    let p = N + 1 + (this.textBuffer[r] ?? 0);
    this.rson[r] = N;
    this.lson[r] = N;
    this.matchLength = 0;

    while (true) {
      if (cmp >= 0) {
        if (this.rson[p] !== N) {
          p = this.rson[p] ?? N;
        } else {
          this.rson[p] = r;
          this.dad[r] = p;
          return;
        }
      } else if (this.lson[p] !== N) {
        p = this.lson[p] ?? N;
      } else {
        this.lson[p] = r;
        this.dad[r] = p;
        return;
      }

      let index = 1;
      for (; index < F; index += 1) {
        cmp = (this.textBuffer[r + index] ?? 0) - (this.textBuffer[p + index] ?? 0);
        if (cmp !== 0) {
          break;
        }
      }

      if (index > THRESHOLD) {
        if (index > this.matchLength) {
          this.matchPosition = (r - p) & (N - 1);
          this.matchLength = index;
          if (this.matchLength >= F) {
            break;
          }
        } else if (index === this.matchLength) {
          const temp = (r - p) & (N - 1);
          if (temp < this.matchPosition) {
            this.matchPosition = temp;
          }
        }
      }
    }

    this.dad[r] = this.dad[p] ?? N;
    this.lson[r] = this.lson[p] ?? N;
    this.rson[r] = this.rson[p] ?? N;
    this.dad[this.lson[p] ?? N] = r;
    this.dad[this.rson[p] ?? N] = r;

    if (this.rson[this.dad[p] ?? N] === p) {
      this.rson[this.dad[p] ?? N] = r;
    } else {
      this.lson[this.dad[p] ?? N] = r;
    }

    this.dad[p] = N;
  }

  private deleteNode(p: number): void {
    if (this.dad[p] === N) {
      return;
    }

    let q: number;
    if (this.rson[p] === N) {
      q = this.lson[p] ?? N;
    } else if (this.lson[p] === N) {
      q = this.rson[p] ?? N;
    } else {
      q = this.lson[p] ?? N;
      if (this.rson[q] !== N) {
        do {
          q = this.rson[q] ?? N;
        } while (this.rson[q] !== N);

        this.rson[this.dad[q] ?? N] = this.lson[q] ?? N;
        this.dad[this.lson[q] ?? N] = this.dad[q] ?? N;
        this.lson[q] = this.lson[p] ?? N;
        this.dad[this.lson[p] ?? N] = q;
      }
      this.rson[q] = this.rson[p] ?? N;
      this.dad[this.rson[p] ?? N] = q;
    }

    this.dad[q] = this.dad[p] ?? N;
    if (this.rson[this.dad[p] ?? N] === p) {
      this.rson[this.dad[p] ?? N] = q;
    } else {
      this.lson[this.dad[p] ?? N] = q;
    }
    this.dad[p] = N;
  }

  private encodeChar(ch: number): void {
    const sym = this.charToSym[ch] ?? 0;
    const range = this.high - this.low;
    this.high = Math.trunc(this.low + (range * (this.symCum[sym - 1] ?? 0)) / this.symCum[0]);
    this.low = Math.trunc(this.low + (range * (this.symCum[sym] ?? 0)) / this.symCum[0]);
    this.normalizeEncode();
    this.updateModel(sym);
  }

  private encodePosition(position: number): void {
    const range = this.high - this.low;
    this.high = Math.trunc(this.low + (range * (this.positionCum[position] ?? 0)) / this.positionCum[0]);
    this.low = Math.trunc(this.low + (range * (this.positionCum[position + 1] ?? 0)) / this.positionCum[0]);
    this.normalizeEncode();
  }

  private normalizeEncode(): void {
    while (true) {
      if (this.high <= Q2) {
        this.output(0);
      } else if (this.low >= Q2) {
        this.output(1);
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.shifts += 1;
        this.low -= Q1;
        this.high -= Q1;
      } else {
        break;
      }

      this.low += this.low;
      this.high += this.high;
    }
  }

  private encodeEnd(): void {
    this.shifts += 1;
    this.output(this.low < Q1 ? 0 : 1);
    this.bits.flush();
  }

  private output(bit: number): void {
    this.bits.putBit(bit);
    while (this.shifts > 0) {
      this.shifts -= 1;
      this.bits.putBit(bit === 0 ? 1 : 0);
    }
  }

  private updateModel(sym: number): void {
    if (this.symCum[0] >= MAX_CUM) {
      let c = 0;
      for (let i = N_CHAR; i >= 1; i -= 1) {
        this.symCum[i] = c;
        this.symFreq[i] = (this.symFreq[i] + 1) >> 1;
        c += this.symFreq[i];
      }
      this.symCum[0] = c;
    }

    let i = sym;
    while (this.symFreq[i] === this.symFreq[i - 1]) {
      i -= 1;
    }

    if (i < sym) {
      const chI = this.symToChar[i];
      const chSym = this.symToChar[sym];
      this.symToChar[i] = chSym;
      this.symToChar[sym] = chI;
      this.charToSym[chI] = sym;
      this.charToSym[chSym] = i;
    }

    this.symFreq[i] += 1;
    i -= 1;

    while (i >= 0) {
      this.symCum[i] += 1;
      i -= 1;
    }
  }
}

export function decodeLzari(input: Buffer, outputLength: number): Buffer {
  const decoder = new LzariDecoder(new BitReader(input));
  return decoder.decode(outputLength);
}

export function encodeLzari(input: Buffer): Buffer {
  const encoder = new LzariEncoder();
  return encoder.encode(input);
}
