/**
 * A date condition's value is a full or partial ISO 8601 UTC timestamp — as
 * much of `YYYY-MM-DDTHH:mm:ss.sssZ` as the user knows, cut off after any
 * part: "2024", "2024-11", "2024-11-06", "2024-11-06T14", "2024-11-06T14:32Z",
 * … The query is sent as the user built it; the backend decides which stored
 * timestamps match at that precision (docs/ARCHITECTURE.md §7, "Dates").
 */

export const UTC_TIMESTAMP_HINT = "YYYY-MM-DDTHH:mm:ssZ";

/**
 * The parts of a full or partial ISO UTC timestamp, each one optional here:
 *
 *     2024  -11  -06  T14  :32  :05  .123  Z
 *     year  mon  day  hour min  sec  frac
 *
 * `timestampParts` then checks what a regex can't say readably: a part only
 * appears after the one before it ("2024T14" has no month and day), and `Z`
 * only after a time. The mock server has its own copy of this
 * (mock-server/evaluate.ts); tests/dateCases.ts makes both accept the same values.
 */
const PARTS =
  /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T(\d{2}))?(?::(\d{2}))?(?::(\d{2}))?(?:\.(\d{1,3}))?(Z)?$/;

/** year, month, day, hour, minute, second, fraction — `undefined` from the first part left out. */
type Parts = [string, ...(string | undefined)[]];

/** The value's parts, or null if it isn't a (partial) ISO UTC timestamp. */
function timestampParts(v: string): Parts | null {
  const m = PARTS.exec(v);
  if (!m) return null;
  const parts = m.slice(1, 8) as Parts;
  const firstMissing = parts.indexOf(undefined);
  if (firstMissing !== -1 && parts.slice(firstMissing).some((p) => p !== undefined)) return null;
  const hasTime = parts[3] !== undefined;
  if (m[8] && !hasTime) return null;
  return parts;
}

const inRange = (part: string | undefined, min: number, max: number) =>
  part === undefined || (Number(part) >= min && Number(part) <= max);

export function isUtcTimestamp(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const parts = timestampParts(v);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month ?? 1), 0)).getUTCDate();
  return (
    inRange(month, 1, 12) &&
    inRange(day, 1, daysInMonth) &&
    inRange(hour, 0, 23) &&
    inRange(minute, 0, 59) &&
    inRange(second, 0, 59)
  );
}
