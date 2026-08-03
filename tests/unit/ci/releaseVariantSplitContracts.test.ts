import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import path from "node:path";

const repoFile = (...segments: string[]) => path.resolve(process.cwd(), ...segments);

const readYaml = <T>(...segments: string[]): T => load(readFileSync(repoFile(...segments), "utf8")) as T;

type Workflow = {
  jobs: Record<
    string,
    {
      outputs?: Record<string, string>;
      env?: Record<string, string>;
      strategy?: { matrix?: { variant?: string } };
    }
  >;
};

type VariantSource = {
  repo: { publish_defaults: Record<string, string[]> };
};

const workflow = () => readYaml<Workflow>(".github/workflows/android.yaml");
const variantSource = () => readYaml<VariantSource>("variants", "variants.yaml");

/**
 * The packaging matrix and the release matrix were both driven from
 * `variant-selection.outputs.publish_variants_json`, so a variant could not be built and
 * verified on every run without also being attached to every release. The two lists are now
 * separate: `publish_defaults.ci` drives packaging and `publish_defaults.release` drives the
 * release upload. These assertions exist so a later edit cannot quietly collapse them back
 * into one list, which would either stop a variant being verified or start publishing it again.
 */
describe("release variant split contracts", () => {
  it("resolves both variant lists from the variant-selection job", () => {
    const outputs = workflow().jobs["variant-selection"]?.outputs ?? {};

    expect(Object.keys(outputs).sort()).toEqual([
      "ci_variants_csv",
      "ci_variants_json",
      "release_variants_csv",
      "release_variants_json",
    ]);
  });

  it("builds and verifies every CI variant in the packaging matrix", () => {
    const packaging = workflow().jobs["android-packaging"];

    expect(packaging?.strategy?.matrix?.variant).toBe(
      "${{ fromJson(needs.variant-selection.outputs.ci_variants_json) }}",
    );
    expect(packaging?.env?.APP_PUBLISH_VARIANTS).toBe("${{ needs.variant-selection.outputs.ci_variants_csv }}");
  });

  it("attaches only release variants to a release", () => {
    const releaseArtifacts = workflow().jobs["release-artifacts"];

    expect(releaseArtifacts?.strategy?.matrix?.variant).toBe(
      "${{ fromJson(needs.variant-selection.outputs.release_variants_json) }}",
    );
    expect(releaseArtifacts?.env?.APP_PUBLISH_VARIANTS).toBe(
      "${{ needs.variant-selection.outputs.release_variants_csv }}",
    );
  });

  it("keeps the packaging matrix and the release matrix reading different outputs", () => {
    const jobs = workflow().jobs;
    const packagingMatrix = jobs["android-packaging"]?.strategy?.matrix?.variant;
    const releaseMatrix = jobs["release-artifacts"]?.strategy?.matrix?.variant;

    expect(packagingMatrix).toBeDefined();
    expect(releaseMatrix).toBeDefined();
    expect(packagingMatrix).not.toBe(releaseMatrix);
  });

  it("no longer references the single combined output", () => {
    const raw = readFileSync(repoFile(".github/workflows/android.yaml"), "utf8");

    expect(raw).not.toContain("publish_variants_json");
    expect(raw).not.toContain("publish_variants_csv");
  });

  it("keeps every variant in the CI list so each one stays built and verified", () => {
    const publishDefaults = variantSource().repo.publish_defaults;

    expect(publishDefaults.ci).toContain("c64commander");
    expect(publishDefaults.ci).toContain("c64u-remote");
  });

  it("publishes a subset of what CI builds", () => {
    const publishDefaults = variantSource().repo.publish_defaults;

    expect(publishDefaults.release.length).toBeGreaterThan(0);
    for (const variant of publishDefaults.release) {
      expect(publishDefaults.ci).toContain(variant);
    }
  });

  it("exports the same split through the generated variant metadata", async () => {
    const generated = (await import("../../../src/generated/variant.json")).default as unknown as {
      repo: { publishDefaults: Record<string, string[]> };
    };
    const publishDefaults = variantSource().repo.publish_defaults;

    expect(generated.repo.publishDefaults.ci).toEqual([...publishDefaults.ci].sort());
    expect(generated.repo.publishDefaults.release).toEqual([...publishDefaults.release].sort());
  });
});
