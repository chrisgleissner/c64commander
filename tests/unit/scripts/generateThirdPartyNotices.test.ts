import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LICENSE_NOTES,
  UNRAR_LICENSE_ID,
  detectLicenseFromFiles,
  isUnresolvedLicense,
  normalizeLicense,
  resolveLicenseUrl,
} from "../../../scripts/generate-third-party-notices.mjs";

const tempDirs: string[] = [];

/** A package directory with a package.json and one bundled licence file. */
const fakePackage = (packageJson: Record<string, unknown>, licenseFileName: string, licenseText: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "notices-pkg-"));
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson), "utf8");
  writeFileSync(path.join(dir, licenseFileName), licenseText, "utf8");
  return dir;
};

const MIT_TEXT = [
  "(c) 2007-2009 Someone <example.com>",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining",
  "a copy of this software and associated documentation files (the",
  '"Software"), to deal in the Software without restriction.',
  "",
  "The above copyright notice and this permission notice shall be",
  "included in all copies or substantial portions of the Software.",
].join("\n");

const BSD_2_TEXT = [
  "Copyright (c) 2026, Someone",
  "All rights reserved.",
  "",
  "Redistribution and use in source and binary forms, with or without modification, are",
  "permitted provided that the following conditions are met:",
  "",
  "   1. Redistributions of source code must retain the above copyright notice.",
  "",
  "   2. Redistributions in binary form must reproduce the above copyright notice, this list",
  "      of conditions and the following disclaimer in the documentation.",
].join("\n");

const BSD_3_TEXT = [
  BSD_2_TEXT,
  "",
  "   3. Neither the name of the copyright holder nor the names of its contributors may be",
  "      used to endorse or promote products derived from this software.",
].join("\n");

const LGPL_UNRAR_TEXT = [
  "  7-Zip",
  "  License for use and distribution",
  "",
  "  Licenses for files are:",
  "    1) 7zz.*.js, 7zz.wasm: GNU LGPL + unRAR restriction",
  "    2) All other files:  GNU LGPL",
  "",
  "  GNU LGPL information",
  "    This library is free software; you can redistribute it and/or",
  "    modify it under the terms of the GNU Lesser General Public",
  "    License as published by the Free Software Foundation; either",
  "    version 2.1 of the License, or (at your option) any later version.",
  "",
  "  unRAR restriction",
  "      The unRAR sources cannot be used to re-create the RAR compression algorithm.",
].join("\n");

const PLAIN_LGPL_TEXT = [
  "                  GNU LESSER GENERAL PUBLIC LICENSE",
  "                       Version 2.1, February 1999",
  "",
  "  This library is free software; you can redistribute it and/or",
  "  modify it under the terms of the GNU Lesser General Public",
  "  License as published by the Free Software Foundation; either",
  "  version 2.1 of the License, or (at your option) any later version.",
].join("\n");

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Three dependencies previously reached THIRD_PARTY_NOTICES.md unresolved, because their
 * package.json either omits `license` or sets it to "SEE LICENSE IN <file>". Each states
 * its terms in a bundled licence file instead. These tests pin the fallback that reads it.
 */
describe("third-party notice licence resolution", () => {
  describe("isUnresolvedLicense", () => {
    it("treats a missing or unknown licence as unresolved", () => {
      expect(isUnresolvedLicense(undefined)).toBe(true);
      expect(isUnresolvedLicense("")).toBe(true);
      expect(isUnresolvedLicense("UNKNOWN")).toBe(true);
    });

    it("treats npm's SEE LICENSE IN convention as unresolved, whatever the filename", () => {
      expect(isUnresolvedLicense("SEE LICENSE IN License.txt")).toBe(true);
      expect(isUnresolvedLicense("see license in COPYING")).toBe(true);
    });

    it("leaves a real SPDX identifier alone", () => {
      expect(isUnresolvedLicense("MIT")).toBe(false);
      expect(isUnresolvedLicense("GPL-3.0-or-later")).toBe(false);
    });
  });

  describe("detectLicenseFromFiles", () => {
    it("resolves a package whose package.json omits license entirely", async () => {
      const dir = fakePackage({ name: "fake-dateformat", version: "1.0.0" }, "LICENSE", MIT_TEXT);

      expect(normalizeLicense(undefined)).toBe("UNKNOWN");
      await expect(detectLicenseFromFiles(dir)).resolves.toBe("MIT");
    });

    it("resolves a package that points at a bundled file", async () => {
      const dir = fakePackage(
        { name: "fake-7z-wasm", version: "1.2.0", license: "SEE LICENSE IN License.txt" },
        "License.txt",
        LGPL_UNRAR_TEXT,
      );

      // The restriction is part of the identifier. Reporting the base licence alone would
      // hide a term that constrains what may be done with the package.
      await expect(detectLicenseFromFiles(dir)).resolves.toBe(UNRAR_LICENSE_ID);
    });

    it("does not attach the restriction to an LGPL package that has none", async () => {
      const dir = fakePackage({ name: "fake-lgpl", version: "1.0.0" }, "COPYING", PLAIN_LGPL_TEXT);

      await expect(detectLicenseFromFiles(dir)).resolves.toBe("LGPL-2.1-or-later");
    });

    it("distinguishes the two- and three-clause BSD licences", async () => {
      const two = fakePackage({ name: "fake-suncalc", version: "2.0.1" }, "LICENSE", BSD_2_TEXT);
      const three = fakePackage({ name: "fake-bsd3", version: "1.0.0" }, "LICENSE", BSD_3_TEXT);

      await expect(detectLicenseFromFiles(two)).resolves.toBe("BSD-2-Clause");
      // The endorsement clause is the only difference, so the more specific match must win.
      await expect(detectLicenseFromFiles(three)).resolves.toBe("BSD-3-Clause");
    });

    it("returns null rather than guessing when no licence file is recognised", async () => {
      const dir = fakePackage({ name: "fake-proprietary", version: "1.0.0" }, "LICENSE", "All rights reserved.");

      await expect(detectLicenseFromFiles(dir)).resolves.toBeNull();
    });

    it("returns null for a package directory with no licence file at all", async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "notices-pkg-"));
      tempDirs.push(dir);
      writeFileSync(path.join(dir, "package.json"), "{}", "utf8");

      await expect(detectLicenseFromFiles(dir)).resolves.toBeNull();
    });
  });

  describe("resolveLicenseUrl", () => {
    it("links a plain SPDX identifier to its SPDX page", () => {
      expect(resolveLicenseUrl("MIT")).toBe("https://spdx.org/licenses/MIT.html");
      expect(resolveLicenseUrl("BSD-2-Clause")).toBe("https://spdx.org/licenses/BSD-2-Clause.html");
    });

    it("links the restricted 7-Zip identifier to the notes that define it", () => {
      // A composite expression would otherwise render as a bare dash, which is unhelpful
      // for the one entry whose terms most need looking up. SPDX cannot describe the
      // restriction, so the link goes to the section of the generated file that does.
      expect(resolveLicenseUrl(UNRAR_LICENSE_ID)).toBe("#licence-notes");
    });

    it("defines that identifier in a section the link actually resolves to", () => {
      // A "#licence-notes" link is only useful if the heading GitHub slugs to that
      // anchor is emitted, and if the section states the restriction rather than just
      // naming it.
      expect(LICENSE_NOTES).toContain("## Licence notes");
      expect(LICENSE_NOTES).toContain(`### ${UNRAR_LICENSE_ID}`);
      expect(LICENSE_NOTES).toContain("cannot be used to re-create the RAR compression algorithm");
      expect(LICENSE_NOTES).toContain("https://spdx.org/licenses/LGPL-2.1-or-later.html");
    });

    it("gives no link for an unresolved licence", () => {
      expect(resolveLicenseUrl("UNKNOWN")).toBe("-");
      expect(resolveLicenseUrl("SEE LICENSE IN License.txt")).toBe("-");
    });
  });
});
