import aesjs from "aes-js";
import { Buffer } from "buffer";
import type { AppSaveDocument } from "./app-model";
import { availableExportFormats, exportUnsignedFormat, sanitizeFileName } from "./export-common";
import type { ExportedSave, ExportFormat } from "./export-service";
import { buildUnsignedPs1Psv, buildUnsignedPs2Psv, makePsvFileName } from "./psv-export-payload";
import { PSV_IV as IV, PSV_KEY0 as KEY0, PSV_KEY1 as KEY1, PSV_LAID_PAID as LAID_PAID, xorBuffers as xor } from "../formats/psv-crypto-common";
function aesEcb(input: Buffer, key: Buffer, encrypt: boolean): Buffer {
  const ecb = new aesjs.ModeOfOperation.ecb(key);
  return Buffer.from(encrypt ? ecb.encrypt(input) : ecb.decrypt(input));
}
async function digest(input: Buffer): Promise<Buffer> {
  const copy = Uint8Array.from(input);
  return Buffer.from(await globalThis.crypto.subtle.digest("SHA-1", copy));
}
async function sign(payload: Buffer): Promise<void> {
  const saveType = payload.readInt32LE(60);
  const seed = payload.subarray(8, 28);
  let salt: Buffer;
  if (saveType === 1) {
    const first = seed.subarray(0, 16);
    const work = Buffer.alloc(16, 0xff); seed.subarray(16).copy(work);
    salt = Buffer.alloc(64); Buffer.concat([xor(aesEcb(first, KEY1, false), IV), xor(aesEcb(first, KEY1, true), work)]).subarray(0, 20).copy(salt);
  } else {
    const padded = Buffer.alloc(64); seed.copy(padded);
    salt = Buffer.concat([Buffer.from(new aesjs.ModeOfOperation.cbc(xor(KEY0, LAID_PAID), IV).decrypt(padded)).subarray(0, 20), Buffer.alloc(44)]);
  }
  const inner = Buffer.from(salt.map((byte) => byte ^ 0x36));
  const outer = Buffer.from(inner.map((byte) => byte ^ 0x6a));
  const unsigned = Buffer.from(payload); unsigned.fill(0, 28, 48);
  (await digest(Buffer.concat([outer, await digest(Buffer.concat([inner, unsigned]))]))).copy(payload, 28);
}

export class BrowserExportService {
  availableFormats(documentModel: AppSaveDocument): ExportFormat[] { return availableExportFormats(documentModel); }
  async export(documentModel: AppSaveDocument, format: ExportFormat): Promise<ExportedSave> {
    if (!this.availableFormats(documentModel).includes(format)) throw new Error(`${format.toUpperCase()} export is not available for ${documentModel.type.toUpperCase()} saves`);
    const baseName = sanitizeFileName(documentModel.dirName || documentModel.displayName);
    const data = format === "psv"
      ? documentModel.type === "ps1" ? buildUnsignedPs1Psv(documentModel.dirName, documentModel.entries[0]?.data ?? Buffer.alloc(0)) : buildUnsignedPs2Psv(documentModel)
      : exportUnsignedFormat(documentModel, format);
    if (format === "psv") await sign(data);
    return { fileName: format === "psv" ? makePsvFileName(documentModel.dirName || documentModel.displayName) : `${baseName}.${format}`, mimeType: "application/octet-stream", data };
  }
}
