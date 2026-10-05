import type { DatabaseError, DatabaseResult } from "../src/model";

// One database's answer to the statistics request (DatabaseResult in
// src/model.ts), for the tests that need a few of them.

export const ok = (databaseId: string, matchCount: number): DatabaseResult => ({
  databaseId,
  status: "ok",
  matchCount,
  notes: [],
});

export const failed = (databaseId: string, ...errors: DatabaseError[]): DatabaseResult => ({
  databaseId,
  status: "failed",
  errors,
  notes: [],
});

/** One problem a database found, pointing at query node `nodeId` (or at none). */
export const dbError = (
  nodeId: string | null,
  message = "Bad.",
  kind: DatabaseError["kind"] = "invalid",
): DatabaseError => ({ nodeId, message, kind });
