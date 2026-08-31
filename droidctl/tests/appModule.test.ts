/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppFilePath } from "../src/tools/modules/app.js";
import { FakeTransport } from "../src/transport/fake.js";
import { createTestContext, invoke } from "./support/harness.js";

const PACKAGE = "uk.gleissner.c64commander";

async function makeApk(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-apk-"));
  const apkPath = path.join(dir, "app.apk");
  await writeFile(apkPath, Buffer.from("PKfake apk bytes"));
  return apkPath;
}

describe("droid_app.install_app", () => {
  it("installs, then verifies with pm list packages, and reports the APK digest", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm list packages", { stdout: `package:${PACKAGE}\n` });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.install_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, apkPath: await makeApk(), allowDowngrade: true },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.data.installed).toBe(true);
    expect(result.data.apkSha256).toMatch(/^[0-9a-f]{64}$/);

    const kinds = transport.calls.map((call) => call.kind);
    expect(kinds).toEqual(["listTargets", "install", "exec"]);
    expect(transport.calls[1]?.argv.slice(0, 3)).toEqual(["install", "-r", "-d"]);
    expect(transport.execArgvLines()).toEqual([`pm list packages ${PACKAGE}`]);
  });

  it("fails when adb reports success but pm list packages does not show the package", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm list packages", { stdout: "" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.install_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, apkPath: await makeApk() },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/pm list packages does not show/);
  });

  it("names the uninstall-first remedy on a signature mismatch", async () => {
    const transport = new FakeTransport();
    transport.installResult = {
      stdout: "",
      stderr: "adb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]",
      exitCode: 1,
      argv: ["adb", "install"],
    };
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.install_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, apkPath: await makeApk() },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/uninstall_app for uk\.gleissner\.c64commander first/);
    expect(transport.execArgvLines()).toEqual([]);
  });

  it("reports a missing APK rather than shelling out", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.install_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, apkPath: "/no/such/app.apk" },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/APK not found/);
    expect(transport.calls.filter((call) => call.kind === "install")).toEqual([]);
  });
});

describe("droid_app.uninstall_app", () => {
  it("succeeds on Success", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm uninstall", { stdout: "Success\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_app.uninstall_app", { targetId: "adb:TESTSERIAL01", package: PACKAGE }, ctx);
    expect(result.data.uninstalled).toBe(true);
  });

  it("tolerates an absent package only when asked to", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm uninstall", { stdout: "Failure [not installed for 0]", exitCode: 1 });
    const { ctx } = await createTestContext({ transport });

    const strict = await invoke("droid_app.uninstall_app", { targetId: "adb:TESTSERIAL01", package: PACKAGE }, ctx);
    expect(strict.ok).toBe(false);

    const tolerant = await invoke(
      "droid_app.uninstall_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, tolerateMissing: true },
      ctx,
    );
    expect(tolerant.ok).toBe(true);
    expect(tolerant.data.tolerated).toBe(true);
  });
});

describe("droid_app.start_app", () => {
  it("parses TotalTime from am start -W and reports the resumed activity", async () => {
    const transport = new FakeTransport();
    transport.respondTo("am start", { stdout: "Status: ok\nActivity: pkg/.Main\nTotalTime: 812\nWaitTime: 830\n" });
    transport.respondTo("dumpsys activity activities", {
      stdout: `  mResumedActivity: ActivityRecord{abc u0 ${PACKAGE}/.MainActivity t42}`,
    });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.start_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, waitForResume: true },
      ctx,
    );

    expect(result.data.totalTimeMs).toBe(812);
    expect(result.data.resumedActivity).toBe(`${PACKAGE}/.MainActivity`);
    expect(transport.execArgvLines()).toContain(`am start -W -n ${PACKAGE}/.MainActivity`);
  });

  it("uses the launcher intent when asked", async () => {
    const transport = new FakeTransport();
    transport.respondTo("dumpsys activity activities", { stdout: `mResumedActivity: ${PACKAGE}/.MainActivity` });
    const { ctx } = await createTestContext({ transport });

    await invoke(
      "droid_app.start_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, viaLauncherIntent: true },
      ctx,
    );

    expect(transport.execArgvLines()).toContain(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`);
  });

  it("fails waitForResume when another application is in front", async () => {
    const transport = new FakeTransport();
    transport.respondTo("am start", { stdout: "Status: ok\nTotalTime: 100\n" });
    transport.respondTo("dumpsys activity activities", { stdout: "mResumedActivity: com.other/.Main" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.start_app",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, waitForResume: true },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/not the resumed activity/);
  });

  it("reports an am start error line as a failure", async () => {
    const transport = new FakeTransport();
    transport.respondTo("am start", { stdout: "Error: Activity class {pkg/.Missing} does not exist." });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_app.start_app", { targetId: "adb:TESTSERIAL01", package: PACKAGE }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/am start reported an error/);
  });
});

describe("droid_app.stop_app and clear_app_data", () => {
  it("force-stops", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });
    const result = await invoke("droid_app.stop_app", { targetId: "adb:TESTSERIAL01", package: PACKAGE }, ctx);
    expect(result.data.stopped).toBe(true);
    expect(transport.execArgvLines()).toContain(`am force-stop ${PACKAGE}`);
  });

  it("refuses pm clear without confirm: true", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_app.clear_app_data", { targetId: "adb:TESTSERIAL01", package: PACKAGE }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_input");
    expect(transport.execArgvLines()).toEqual([]);
  });

  it("clears when confirmed", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm clear", { stdout: "Success\n" });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.clear_app_data",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, confirm: true },
      ctx,
    );
    expect(result.data.cleared).toBe(true);
  });

  it("reports a pm clear that did not report Success", async () => {
    const transport = new FakeTransport();
    transport.respondTo("pm clear", { stdout: "Failed\n", exitCode: 1 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.clear_app_data",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, confirm: true },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});

describe("app private files over run-as", () => {
  it("confines the path to the application's files/ directory", () => {
    expect(resolveAppFilePath("config.json")).toBe("files/config.json");
    expect(resolveAppFilePath("files/nested/config.json")).toBe("files/nested/config.json");
    expect(() => resolveAppFilePath("../../etc/passwd")).toThrow(/must stay inside/);
    expect(() => resolveAppFilePath("files/../secrets")).toThrow(/must stay inside/);
  });

  it("writes through run-as with the payload on stdin", async () => {
    const transport = new FakeTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.write_app_file",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, relativePath: "seed.json", content: '{"a":1}' },
      ctx,
    );

    expect(result.data).toMatchObject({ bytesWritten: 7, path: "files/seed.json" });
    const line = transport.execArgvLines()[0] ?? "";
    expect(line).toContain(`run-as ${PACKAGE} sh -c`);
    expect(line).toContain("mkdir -p 'files'");
    expect(line).toContain("cat > 'files/seed.json'");
  });

  it("detects a run-as refusal that exits 0 with an empty body", async () => {
    const transport = new FakeTransport();
    transport.respondTo("run-as", { stdout: `run-as: package not debuggable: ${PACKAGE}`, exitCode: 0 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.write_app_file",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, relativePath: "seed.json", content: "{}" },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/run-as write .* failed/);
  });

  it("reads a file back and honours maxBytes", async () => {
    const transport = new FakeTransport();
    transport.respondTo("cat 'files/out.json'", { stdout: '{"result":"ok"}' });
    const { ctx } = await createTestContext({ transport });

    const full = await invoke(
      "droid_app.read_app_file",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, relativePath: "out.json" },
      ctx,
    );
    expect(full.data).toMatchObject({ content: '{"result":"ok"}', bytes: 15, truncated: false });

    const clipped = await invoke(
      "droid_app.read_app_file",
      { targetId: "adb:TESTSERIAL01", package: PACKAGE, relativePath: "out.json", maxBytes: 4 },
      ctx,
    );
    expect(clipped.data).toMatchObject({ content: '{"re', truncated: true });
  });

  it("reports a run-as read refusal", async () => {
    const transport = new FakeTransport();
    transport.respondTo("run-as", { stdout: "", stderr: "run-as: unknown package: nope", exitCode: 1 });
    const { ctx } = await createTestContext({ transport });

    const result = await invoke(
      "droid_app.read_app_file",
      { targetId: "adb:TESTSERIAL01", package: "nope", relativePath: "out.json" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
