import { Timestamp } from "firebase/firestore";

export function asDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") return new Date(value);
  return new Date(0);
}

export function asNullableDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
