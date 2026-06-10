export function scoreIf(condition: boolean, score: number) {
  return condition ? score : 0;
}

export function compareNumbers(a: number | null | undefined, b: number | null | undefined) {
  const left = validNumber(a);
  const right = validNumber(b);
  if (left === null || right === null) return 0;
  return left - right;
}

export function valueOrInfinity(value: number | null | undefined) {
  return validNumber(value) ?? Number.POSITIVE_INFINITY;
}

export function valueOrZero(value: number | null | undefined) {
  return validNumber(value) ?? 0;
}

export function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

export function nullableRound(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? null : round(value, digits);
}

export function nearestBelow(price: number, levels: Array<number | null | undefined>) {
  const values = levels.map(validNumber).filter((value): value is number => value !== null && value > 0 && value <= price);
  if (!values.length) return null;
  return Math.max(...values);
}

export function nearestAbove(price: number, levels: Array<number | null | undefined>) {
  const values = levels.map(validNumber).filter((value): value is number => value !== null && value > 0 && value >= price);
  if (!values.length) return null;
  return Math.min(...values);
}

export function formatZone(...values: Array<number | null | undefined>) {
  const valid = values.map(validNumber).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  if (!valid.length) return "--";
  const low = valid[0];
  const high = valid[Math.min(valid.length - 1, 1)] ?? low;
  return `${formatLevel(low)}-${formatLevel(high)}`;
}

export function formatLevel(value: number | null | undefined) {
  const number = validNumber(value);
  if (number === null) return "--";
  return number >= 100 ? number.toFixed(2) : number.toFixed(3);
}
