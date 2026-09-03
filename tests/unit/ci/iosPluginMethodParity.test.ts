import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Holds the Swift plugin surface to the TypeScript plugin contracts.
 *
 * A Capacitor plugin method that a TypeScript interface declares but the Swift
 * `pluginMethods` array does not list rejects at runtime with
 * `"<Plugin>.<method>()" is not implemented on ios`. Nothing caught that: the TypeScript
 * side assumes the native surface is uniform, and no test read the Swift files. The
 * iOS Maestro flows do not exercise folder import or a long offline session, which is
 * where the gaps show up.
 *
 * The check runs here rather than on a macOS runner on purpose. It is a source
 * comparison, so it needs no Swift compiler and it fails on the machine that made the
 * change instead of twenty minutes later in CI.
 */

const APP_SOURCE_DIR = path.resolve(process.cwd(), "ios", "App", "App");
const NATIVE_CONTRACT_DIR = path.resolve(process.cwd(), "src", "lib", "native");

/* `CAPPlugin` supplies these, so a plugin never lists them in `pluginMethods`. */
const CAPACITOR_BASE_METHODS = new Set(["addListener", "removeAllListeners"]);

export type SwiftPlugin = { jsName: string; file: string; methods: string[] };

export const readSwiftPluginMethods = (dir = APP_SOURCE_DIR): Map<string, SwiftPlugin> => {
  const plugins = new Map<string, SwiftPlugin>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".swift"))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    const declaration = /jsName\s*=\s*"(\w+)"[\s\S]*?pluginMethods:\s*\[CAPPluginMethod\]\s*=\s*\[([\s\S]*?)\n\s*\]/g;
    let match: RegExpExecArray | null;
    while ((match = declaration.exec(source)) !== null) {
      plugins.set(match[1], {
        jsName: match[1],
        file,
        methods: [...match[2].matchAll(/CAPPluginMethod\(name:\s*"(\w+)"/g)].map((entry) => entry[1]),
      });
    }
  }
  return plugins;
};

export type TypeScriptPlugin = { jsName: string; file: string; methods: string[] };

export const readTypeScriptPluginContracts = (dir = NATIVE_CONTRACT_DIR): Map<string, TypeScriptPlugin> => {
  const plugins = new Map<string, TypeScriptPlugin>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !/\.(web|test)\.ts$/.test(name))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    const registration = /registerPlugin<(\w+)>\("(\w+)"/.exec(source);
    if (registration === null) continue;
    const [, typeName, jsName] = registration;
    /* Both declaration forms are in use across `src/lib/native`. */
    const body =
      new RegExp(`(?:export )?type ${typeName} = \\{([\\s\\S]*?)\\n\\};`).exec(source) ??
      new RegExp(`(?:export )?interface ${typeName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
    if (body === null) throw new Error(`Could not read the body of ${typeName} in ${file}`);
    plugins.set(jsName, {
      jsName,
      file,
      /* Top-level members only: two spaces of indent, then a name and a `:` or `(`. */
      methods: [...body[1].matchAll(/^ {2}(\w+)\??\s*[:(]/gm)]
        .map((entry) => entry[1])
        .filter((name) => !CAPACITOR_BASE_METHODS.has(name)),
    });
  }
  return plugins;
};

/*
 * Methods a TypeScript contract declares that the Swift plugin does not implement.
 * Every entry needs a reason, and the list may only shrink: a method that has since been
 * implemented is reported so the entry is removed in the same change.
 *
 * HARD27-003 named the FtpClient and DeviceDiscovery rows. Building this check found the
 * other four, which the review did not report.
 */
export const KNOWN_IOS_METHOD_GAPS = new Map<string, Map<string, string>>([
  [
    "FtpClient",
    new Map([
      ["listDirectoryRecursive", "HARD27-003: folder import rejects on iOS; callers fall back to the JS walker"],
    ]),
  ],
  [
    "BackgroundExecution",
    new Map([
      ["setPlaybackState", "iOS has no media-session surface to update; the matrix records the plugin as Partial"],
      ["setNowPlaying", "iOS has no media-session surface to update; the matrix records the plugin as Partial"],
      ["checkPermissions", "iOS needs no runtime notification permission for background audio"],
      ["requestPermissions", "iOS needs no runtime notification permission for background audio"],
    ]),
  ],
  ["DiagnosticsBridge", new Map([["emitLog", "iOS logs through IOSDiagnostics directly rather than over the bridge"]])],
  [
    "FolderPicker",
    new Map([["releasePersistedUris", "iOS security-scoped bookmarks are released when they go out of scope"]]),
  ],
  [
    "HvscIngestion",
    new Map([
      ["getStorageBudget", "HARD27-028: the free-space check is the outstanding Swift half"],
      ["downloadArchive", "iOS downloads the archive in TypeScript; only extraction is native"],
    ]),
  ],
]);

/* TypeScript contracts with no Swift plugin at all. These are documented in the parity matrix. */
export const ANDROID_ONLY_PLUGINS = new Set(["StreamUdp", "DeviceRotation", "SafeArea", "LibraryInstall"]);

export const findParityGaps = (
  swift: Map<string, SwiftPlugin>,
  typescript: Map<string, TypeScriptPlugin>,
  known = KNOWN_IOS_METHOD_GAPS,
) => {
  const unexpected: Array<{ jsName: string; method: string }> = [];
  const staleGaps: Array<{ jsName: string; method: string }> = [];

  for (const [jsName, contract] of typescript) {
    const implementation = swift.get(jsName);
    if (implementation === undefined) continue;
    const allowed = known.get(jsName) ?? new Map<string, string>();
    for (const method of contract.methods) {
      if (implementation.methods.includes(method)) {
        if (allowed.has(method)) staleGaps.push({ jsName, method });
      } else if (!allowed.has(method)) {
        unexpected.push({ jsName, method });
      }
    }
    for (const method of allowed.keys()) {
      if (!contract.methods.includes(method)) staleGaps.push({ jsName, method });
    }
  }

  return { unexpected, staleGaps };
};

describe("iOS plugin method parity", () => {
  const swift = readSwiftPluginMethods();
  const typescript = readTypeScriptPluginContracts();

  it("reads every Swift plugin and every registered TypeScript contract", () => {
    expect(swift.size).toBeGreaterThanOrEqual(10);
    expect(typescript.size).toBeGreaterThanOrEqual(13);
    // A parsing failure would silently make every other case in this file pass.
    expect(swift.get("FtpClient")?.methods).toContain("listDirectory");
    expect(typescript.get("FtpClient")?.methods).toContain("listDirectoryRecursive");
  });

  it("has no TypeScript method without a Swift implementation or a recorded reason", () => {
    const { unexpected } = findParityGaps(swift, typescript);
    const described = unexpected.map(({ jsName, method }) => `${jsName}.${method}`);
    expect(described, "implement these in Swift, or record why iOS does without them").toEqual([]);
  });

  it("keeps the recorded gap list shrinking", () => {
    const { staleGaps } = findParityGaps(swift, typescript);
    const described = staleGaps.map(({ jsName, method }) => `${jsName}.${method}`);
    expect(described, "these are implemented or gone; remove them from KNOWN_IOS_METHOD_GAPS").toEqual([]);
  });

  it("gives a reason for every recorded gap", () => {
    for (const [jsName, methods] of KNOWN_IOS_METHOD_GAPS) {
      for (const [method, reason] of methods) {
        expect(reason.length, `${jsName}.${method} needs a reason`).toBeGreaterThan(20);
      }
    }
  });

  it("reports a TypeScript method that Swift does not implement and nothing records", () => {
    // The state HARD27-003 found: a declared method with no Swift counterpart and no record.
    const withoutRecord = new Map(KNOWN_IOS_METHOD_GAPS);
    withoutRecord.set("FtpClient", new Map());
    const { unexpected } = findParityGaps(swift, typescript, withoutRecord);
    expect(unexpected).toContainEqual({ jsName: "FtpClient", method: "listDirectoryRecursive" });
  });

  it("reports a recorded gap that Swift now implements", () => {
    const overRecorded = new Map(KNOWN_IOS_METHOD_GAPS);
    overRecorded.set("SecureStorage", new Map([["getPassword", "not actually missing; this entry is stale"]]));
    const { staleGaps } = findParityGaps(swift, typescript, overRecorded);
    expect(staleGaps).toContainEqual({ jsName: "SecureStorage", method: "getPassword" });
  });

  it("records the plugins that have no Swift counterpart at all", () => {
    const missingEntirely = [...typescript.keys()].filter((jsName) => !swift.has(jsName));
    expect(new Set(missingEntirely)).toEqual(ANDROID_ONLY_PLUGINS);
  });

  it("keeps the parity matrix honest about the Android-only plugins", () => {
    const matrix = readFileSync(path.resolve(process.cwd(), "docs", "internals", "ios-parity-matrix.md"), "utf8");
    for (const jsName of ANDROID_ONLY_PLUGINS) {
      expect(matrix, `${jsName} is Android-only and the matrix should say so`).toContain(`${jsName}Plugin`);
    }
  });
});
