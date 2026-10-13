import { describe, it, expect } from "vitest";
import { EVENT_SAMPLE_SIZE, idleMessage } from "../../src/ui/dataPreview";

describe("idleMessage", () => {
  it("promises a random sample of up to the sample size", () => {
    expect(EVENT_SAMPLE_SIZE).toBe(2000);
    expect(idleMessage("en-US")).toBe(
      "Fetch a random sample of up to 2,000 events this query matches.",
    );
  });
});
