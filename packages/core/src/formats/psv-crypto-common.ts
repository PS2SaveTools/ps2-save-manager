export const PSV_SALT_SEED = Buffer.from("7777772e70733273617665746f6f6c732e636f6d", "hex");
export const PSV_IV = Buffer.from("B30FFEEDB7DC5EB7133DA60D1B6B2CDC", "hex");
export const PSV_KEY0 = Buffer.from("FA72CEEF59B4D2989F111913287F51C7", "hex");
export const PSV_KEY1 = Buffer.from("AB5ABC9FC1F49DE6A051DBAEFA518859", "hex");
export const PSV_LAID_PAID = Buffer.from("107000000200000110700003ff000001", "hex");

export function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const output = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < output.length; index += 1) output[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  return output;
}

export function xorWithByte(input: Buffer, value: number): Buffer {
  return Buffer.from(input.map((byte) => byte ^ value));
}
