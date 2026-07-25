export function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}
