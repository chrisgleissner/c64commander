import { describe, expect, it } from "vitest";

import {
  ReleaseArtifactValidationError,
  validateArtifactEntries,
} from "../../../scripts/validate-release-artifact.mjs";

describe("validate-release-artifact", () => {
  it("accepts Android release contents with bundled 7-Zip payloads", () => {
    const summary = validateArtifactEntries("android", [
      "META-INF/MANIFEST.MF",
      "assets/public/index.html",
      "assets/public/manifest.webmanifest",
      "assets/public/assets/7zz-CgkXYLdN.wasm",
      "assets/public/assets/vendor-hvsc-C-AwZvTM.js",
      "lib/arm64-v8a/lib7zz.so",
      "lib/armeabi-v7a/lib7zz.so",
      "res/layout/main.xml",
    ]);

    expect(summary.platform).toBe("android");
    expect(summary.missing).toEqual([]);
  });

  it("rejects Android artifacts when arm release 7-Zip runtime is missing", () => {
    expect(() =>
      validateArtifactEntries("android", [
        "META-INF/MANIFEST.MF",
        "assets/public/index.html",
        "assets/public/manifest.webmanifest",
        "assets/public/assets/7zz-CgkXYLdN.wasm",
        "assets/public/assets/vendor-hvsc-C-AwZvTM.js",
        "lib/armeabi-v7a/lib7zz.so",
        "res/layout/main.xml",
      ]),
    ).toThrowError(ReleaseArtifactValidationError);
  });

  it("accepts iOS release contents with SWCompression and wasm fallback", () => {
    const summary = validateArtifactEntries("ios", [
      "Payload/App.app/Assets.car",
      "Payload/App.app/public/index.html",
      "Payload/App.app/public/manifest.webmanifest",
      "Payload/App.app/public/assets/7zz-CgkXYLdN.wasm",
      "Payload/App.app/public/assets/vendor-hvsc-C-AwZvTM.js",
      "Payload/App.app/Frameworks/SWCompression.framework/SWCompression",
      "Payload/App.app/Frameworks/Capacitor.framework/native-bridge.js",
    ]);

    expect(summary.platform).toBe("ios");
    expect(summary.missing).toEqual([]);
  });

  it("rejects iOS artifacts when SWCompression is missing", () => {
    expect(() =>
      validateArtifactEntries("ios", [
        "Payload/App.app/Assets.car",
        "Payload/App.app/public/index.html",
        "Payload/App.app/public/manifest.webmanifest",
        "Payload/App.app/public/assets/7zz-CgkXYLdN.wasm",
        "Payload/App.app/public/assets/vendor-hvsc-C-AwZvTM.js",
        "Payload/App.app/Frameworks/Capacitor.framework/native-bridge.js",
      ]),
    ).toThrowError(ReleaseArtifactValidationError);
  });
});
