import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveEdition } from "../../../scripts/build-manuals.mjs";

/**
 * 1.0.0 was tagged at the commit 0.11.0-rc3 already tagged, and the manual
 * published with 1.0.0 was stamped 0.11.0-rc3, because `git describe` cannot
 * tell which tag started the build.
 */

const KEYS = ["GITHUB_REF", "APP_VERSION", "VERSION_NAME"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the manual's edition", () => {
  it("is the tag being built, not whichever tag git describe reaches first", () => {
    process.env.GITHUB_REF = "refs/tags/9.9.9-edition-probe";
    expect(resolveEdition()).toBe("9.9.9-edition-probe");
  });

  it("takes a version the caller resolved itself when there is no tag ref", () => {
    process.env.APP_VERSION = "8.8.8-provided-probe";
    expect(resolveEdition()).toBe("8.8.8-provided-probe");
  });

  it("prefers the tag ref over a provided version, since the tag is what published", () => {
    process.env.GITHUB_REF = "refs/tags/9.9.9-edition-probe";
    process.env.APP_VERSION = "8.8.8-provided-probe";
    expect(resolveEdition()).toBe("9.9.9-edition-probe");
  });

  it("ignores a ref that is not a tag", () => {
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.APP_VERSION = "8.8.8-provided-probe";
    expect(resolveEdition()).toBe("8.8.8-provided-probe");
  });

  it("still resolves something when nothing is in the environment", () => {
    expect(resolveEdition()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
