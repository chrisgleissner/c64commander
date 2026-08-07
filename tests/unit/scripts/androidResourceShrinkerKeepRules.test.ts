import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The release build type sets `shrinkResources true`. The shrinker keeps a resource only
 * when it can see a static reference to it, so anything resolved by name at runtime
 * (Resources.getIdentifier) has to be named in res/raw/keep.xml or it is stripped from the
 * shipped APK while remaining present in every debug build.
 *
 * This bit us once already: Capacitor's Bridge.create() runs
 * org.apache.cordova.ConfigXmlParser, which resolves the Cordova config with
 * Resources.getIdentifier("config", "xml", ...). Release APKs did not contain the
 * resource, and every launch logged "E ConfigXmlParser: res/xml/config.xml is missing!".
 * `aapt2 dump resources` on a published release APK showed four of the five xml resources
 * present, with the id slot belonging to `config` empty.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RES_DIR = path.join(REPO_ROOT, "android/app/src/main/res");
const KEEP_XML = path.join(RES_DIR, "raw/keep.xml");
const BUILD_GRADLE = path.join(REPO_ROOT, "android/app/build.gradle");

// Each entry is a resource the app never references from code or from another resource,
// and the runtime lookup that needs it to survive shrinking.
const REFLECTIVELY_RESOLVED_RESOURCES = [
  {
    reference: "@xml/config",
    file: "xml/config.xml",
    resolvedBy: 'org.apache.cordova.ConfigXmlParser via Resources.getIdentifier("config", "xml", ...)',
  },
] as const;

describe("release resource shrinking keep rules", () => {
  it("the release build type still shrinks resources, so keep rules are still required", () => {
    // If this ever changes, keep.xml becomes redundant rather than wrong, but the reader
    // of a failure here should know which assumption moved.
    // Scoped to the buildTypes section: `release {` also appears under sourceSets, and
    // minifiedDebug deliberately sets shrinkResources false.
    const gradle = readFileSync(BUILD_GRADLE, "utf8");
    const buildTypes = /\n {4}buildTypes \{[\s\S]*?\n {4}\}/.exec(gradle)?.[0] ?? "";
    expect(buildTypes, "could not locate the buildTypes block in build.gradle").not.toBe("");
    const releaseBlock = /\n {8}release \{[\s\S]*?\n {8}\}/.exec(buildTypes)?.[0] ?? "";
    expect(releaseBlock).toContain("shrinkResources true");
  });

  it("keep.xml exists and is a resource-shrinker keep file", () => {
    expect(existsSync(KEEP_XML)).toBe(true);
    const keep = readFileSync(KEEP_XML, "utf8");
    expect(keep).toContain('xmlns:tools="http://schemas.android.com/tools"');
    expect(keep).toMatch(/tools:keep\s*=/);
  });

  it.each(REFLECTIVELY_RESOLVED_RESOURCES)(
    "keeps $reference, which is resolved by name at runtime",
    ({ reference, file, resolvedBy }) => {
      // The resource file itself is NOT asserted to exist. `xml/config.xml` is generated
      // by `cap sync` and is gitignored, so it is absent in a fresh checkout - and the
      // job that runs these tests installs dependencies and runs vitest without ever
      // syncing Capacitor. Requiring the file would fail there for a reason that has
      // nothing to do with the keep rule. When it does happen to be present, its
      // location is still checked, so a resource that moved is still caught.
      const resourcePath = path.join(RES_DIR, file);
      if (existsSync(path.dirname(resourcePath))) {
        const generated = existsSync(resourcePath);
        if (!generated) {
          expect(
            existsSync(path.join(REPO_ROOT, ".gitignore")) &&
              readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8").includes(`android/app/src/main/res/${file}`),
            `${file} is absent and is not gitignored, so it is genuinely missing rather than merely ungenerated`,
          ).toBe(true);
        }
      }

      const keepValue = /tools:keep\s*=\s*"([^"]*)"/.exec(readFileSync(KEEP_XML, "utf8"))?.[1] ?? "";
      const kept = keepValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      expect(kept, `${reference} is resolved by ${resolvedBy}, so the shrinker cannot see it`).toContain(reference);
    },
  );
});
