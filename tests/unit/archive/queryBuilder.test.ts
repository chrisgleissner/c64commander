import { describe, expect, it } from "vitest";
import { buildArchiveQuery, buildArchiveQueryParam } from "@/lib/archive/queryBuilder";

describe("archive query builder", () => {
  it("builds quoted and unquoted clauses deterministically", () => {
    expect(
      buildArchiveQuery({
        name: "Joyride",
        handle: "A-Man",
        category: "apps",
        type: "prg",
      }),
    ).toBe('(name:"Joyride") & (handle:"A-Man") & (category:apps) & (type:prg)');
  });

  it("URL-encodes the rendered AQL query", () => {
    expect(buildArchiveQueryParam({ name: "A B", category: "games" })).toBe(
      encodeURIComponent('(name:"A B") & (category:games)'),
    );
  });

  it("rejects empty queries", () => {
    expect(() => buildArchiveQuery({})).toThrow("Enter at least one archive search term.");
  });
});
