export interface AuditEntry {
  name: string;
  reason: string;
  timestamp: string;
}

/**
 * Dev-only stand-in for forwarding a per-extraction audit entry to a real
 * audit/compliance service over the network. This in-memory array resets on
 * every process restart and is never actually sent anywhere — production
 * needs a real, durable audit store and a real network call (issue #15;
 * docs/superpowers/specs/2026-09-23-compliance-logging-design.md, §7).
 */
const AUDIT_LOG: AuditEntry[] = [];

/** Called once per successful POST /api/query (queryEvents in mock-server/server.ts). */
export function logQueryAudit(name: string, reason: string): void {
  AUDIT_LOG.push({ name, reason, timestamp: new Date().toISOString() });
}

export function auditLogSnapshot(): AuditEntry[] {
  return [...AUDIT_LOG];
}
