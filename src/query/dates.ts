/**
 * A date condition's value is a full or partial ISO 8601 UTC timestamp — as
 * much of `YYYY-MM-DDTHH:mm:ss.sssZ` as the user knows, cut off after any
 * part: "2024", "2024-11", "2024-11-06", "2024-11-06T14", "2024-11-06T14:32Z",
 * … The query is sent as the user built it; the backend decides which stored
 * timestamps match at that precision (docs/ARCHITECTURE.md §7, "Dates").
 */

export const UTC_TIMESTAMP_HINT = "YYYY-MM-DDTHH:mm:ssZ";

const PARTIAL_UTC =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?Z?)?)?)?$/;

const inRange = (part: string | undefined, min: number, max: number) =>
  part === undefined || (Number(part) >= min && Number(part) <= max);

export function isUtcTimestamp(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = PARTIAL_UTC.exec(v);
  if (!m) return false;
  const [, year, month, day, hour, minute, second] = m;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month ?? 1), 0)).getUTCDate();
  return (
    inRange(month, 1, 12) &&
    inRange(day, 1, daysInMonth) &&
    inRange(hour, 0, 23) &&
    inRange(minute, 0, 59) &&
    inRange(second, 0, 59)
  );
}
