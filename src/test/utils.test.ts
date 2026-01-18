import { describe, it, expect } from "vitest";
import { cn } from "../lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("deduplicates tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
