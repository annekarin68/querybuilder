/**
 * Date values shared by the frontend's and the mock's tests. The frontend
 * (src/query/dates.ts, isUtcTimestamp) and the mock (mock-server/evaluate.ts,
 * utcSpan) each have their own copy of the "(partial) ISO UTC timestamp"
 * pattern, because the mock shares no runtime code with src/. These lists
 * make both tests check the same values, so the copies can't drift apart.
 */

/** Full or partial ISO 8601 UTC timestamps: both must accept these. */
export const WELL_FORMED = [
  "2024",
  "2024-11",
  "2024-11-06",
  "2024-11-06T14",
  "2024-11-06T14Z",
  "2024-11-06T14:32",
  "2024-11-06T14:32Z",
  "2024-11-06T14:32:05",
  "2024-11-06T14:32:05Z",
  "2024-11-06T14:32:05.1Z",
  "2024-11-06T14:32:05.123Z",
  "2024-02-29",
  "2024-12-31T23:59:59.999Z",
];

/** Not in the format at all: both must reject these. */
export const MALFORMED = [
  "",
  "24",
  "2024-1",
  "2024-11-06T",
  "2024-11-06T14:32:05.1234Z",
  "2024-11-06Z",
  "2024Z",
  "2024T14",
  "2024-11T14",
  "2024-11-06T14.5",
  "2024-11-06T14:32+02:00",
  "2024-11-06 14:32",
  " 2024-11-06",
  "06/11/2024",
];

/** In the format, but no such date or time. Only the frontend checks this. */
export const OUT_OF_RANGE = [
  "2024-13",
  "2024-00",
  "2023-02-29",
  "2024-11-31",
  "2024-11-06T24",
  "2024-11-06T14:60",
  "2024-11-06T14:32:60",
];
