import { describe, expect, it } from "vitest";

import { resolveExpectedVersionPattern, resolveExpectedVersions } from "../../../playwright/versionExpectation";

describe("playwright version expectation", () => {
    it("accepts the latest clean tag because resolve-version.sh emits that label on non-tag branch builds", () => {
        const env = {
            VITE_APP_VERSION: "",
            VERSION_NAME: "",
            GITHUB_REF_TYPE: "branch",
            GITHUB_REF_NAME: "main",
            GITHUB_REF: "refs/heads/main",
            GITHUB_SHA: "d207230e1234567890",
        };
        const runGit = (args: string[]) => {
            const key = args.join(" ");
            if (key === "describe --tags --long --dirty --always") return "0.7.8-3-gd207230e";
            if (key === "describe --tags --abbrev=0") return "0.7.8";
            if (key === "describe --tags --long --dirty") return "0.7.8-3-gd207230e";
            if (key === "rev-parse HEAD") return "d207230e1234567890";
            return "";
        };

        expect(resolveExpectedVersions({ env, runGit, readPackageVersion: () => "0.7.9-rc1" })).toContain("0.7.8");
        expect(resolveExpectedVersionPattern({ env, runGit, readPackageVersion: () => "0.7.9-rc1" })).toMatchObject(
            expect.any(RegExp),
        );
        expect(resolveExpectedVersionPattern({ env, runGit, readPackageVersion: () => "0.7.9-rc1" })?.test("0.7.8")).toBe(
            true,
        );
    });
});
