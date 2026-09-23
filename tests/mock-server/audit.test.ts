import { describe, it, expect } from "vitest";
import { logQueryAudit, auditLogSnapshot } from "../../mock-server/audit";

describe("audit log", () => {
  it("appends an entry with the given name and reason, and a timestamp", () => {
    const before = auditLogSnapshot().length;
    logQueryAudit("demo.user", "investigating incident #123");
    const after = auditLogSnapshot();
    expect(after.length).toBe(before + 1);
    const entry = after[after.length - 1]!;
    expect(entry.name).toBe("demo.user");
    expect(entry.reason).toBe("investigating incident #123");
    expect(typeof entry.timestamp).toBe("string");
    expect(Number.isNaN(new Date(entry.timestamp).getTime())).toBe(false);
  });

  it("auditLogSnapshot returns a copy, not the live array", () => {
    const snapshot = auditLogSnapshot();
    snapshot.push({ name: "x", reason: "y", timestamp: "z" });
    expect(auditLogSnapshot().length).not.toBe(snapshot.length);
  });
});
