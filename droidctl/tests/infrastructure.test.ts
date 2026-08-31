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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { parseGetpropDump, parseWmDensity, parseWmSize } from "../src/deviceInfo.js";
import { ToolExecutionError, ToolValidationError, toolErrorResult, unknownErrorResult } from "../src/tools/errors.js";
import { requireCapability, shellQuote } from "../src/tools/common.js";
import { jsonResult } from "../src/tools/responses.js";
import { defineToolModule, parseZodArgs } from "../src/tools/types.js";
import { modules } from "../src/tools/registry.js";
import { AdbTransport, nodeExecRunner, nodeSpawnRunner } from "../src/transport/adb.js";
import { FakeTransport, defaultTarget } from "../src/transport/fake.js";
import { TransportRegistry } from "../src/transport/registry.js";
import type { TransportCapabilities } from "../src/transport/types.js";
import { createTestContext, invoke } from "./support/harness.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["DROIDCTL_DEBUG"];
});

describe("logger", () => {
  it("writes to stderr, and emits debug only when DROIDCTL_DEBUG is set", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("unit");

    logger.debug("hidden");
    expect(spy).not.toHaveBeenCalled();

    process.env["DROIDCTL_DEBUG"] = "1";
    logger.debug("shown", { a: 1 });
    logger.info("info");
    logger.warn("warn", {});
    logger.error("error", { b: "c" });

    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      '[unit] shown {"a":1}',
      "[unit] info",
      "[unit] warn",
      '[unit] error {"b":"c"}',
    ]);
  });

  it("drops details it cannot serialise rather than throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    createLogger("unit").info("message", cyclic);
    expect(spy.mock.calls[0]?.[0]).toBe("[unit] message");
  });
});

describe("device property parsing", () => {
  it("reads a getprop dump and ignores lines that are not properties", () => {
    const props = parseGetpropDump("[ro.product.model]: [Pixel 4]\ngarbage\n[a.b]: []\n");
    expect(props.get("ro.product.model")).toBe("Pixel 4");
    expect(props.get("a.b")).toBe("");
    expect(props.size).toBe(2);
  });

  it("reads physical and override geometry, and reports null when absent", () => {
    expect(parseWmSize("Physical size: 1080x2280\nOverride size: 480x640\n")).toEqual({
      physical: "1080x2280",
      override: "480x640",
    });
    expect(parseWmSize("")).toEqual({ physical: null, override: null });
    expect(parseWmDensity("Physical density: 440\n")).toEqual({ physical: 440, override: null });
    expect(parseWmDensity("")).toEqual({ physical: null, override: null });
  });
});

describe("error envelopes", () => {
  it("carries the kind, code and details of a tool error", () => {
    const result = toolErrorResult(new ToolExecutionError("boom", { code: "timeout", details: { a: 1 } }));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      ok: false,
      error: { kind: "execution", code: "timeout", message: "boom", details: { a: 1 } },
    });
  });

  it("converts an unexpected throw into an internal_error envelope", () => {
    expect(JSON.parse(unknownErrorResult(new Error("unexpected")).content[0]!.text).error).toMatchObject({
      kind: "unknown",
      code: "internal_error",
      message: "unexpected",
    });
    expect(JSON.parse(unknownErrorResult("plain string").content[0]!.text).error.message).toBe("plain string");
    expect(JSON.parse(unknownErrorResult(new ToolValidationError("bad")).content[0]!.text).error.kind).toBe(
      "validation",
    );
  });

  it("wraps a zod failure and rethrows anything else", () => {
    const throwing = {
      parse() {
        throw new RangeError("not a zod error");
      },
    };
    expect(() => parseZodArgs(throwing, {})).toThrow(RangeError);
  });
});

describe("tool module dispatch", () => {
  it("rejects an unknown tool name inside a module", async () => {
    const module = defineToolModule({ domain: "x", summary: "y", tools: [] });
    await expect(module.invoke("x.nope", {}, {} as never)).rejects.toThrow(ToolValidationError);
    expect(module.describeTools()).toEqual([]);
  });

  it("stamps the tool name onto the context it dispatches with", async () => {
    let seen: string | undefined;
    const module = defineToolModule({
      domain: "probe",
      summary: "s",
      tools: [
        {
          name: "probe.echo",
          description: "d",
          inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
          argsSchema: { parse: (value: unknown) => value } as never,
          async execute(_args, ctx) {
            seen = ctx.toolName;
            return jsonResult({ ok: true });
          },
        },
      ],
    });
    await module.invoke("probe.echo", {}, {} as never);
    expect(seen).toBe("probe.echo");
  });

  it("registers six modules whose domains match their tool prefixes", () => {
    expect(modules.flatMap((module) => module.describeTools())).toHaveLength(25);
    for (const module of modules) {
      for (const descriptor of module.describeTools()) {
        expect(descriptor.name.startsWith(`${module.domain}.`)).toBe(true);
        expect(descriptor.metadata).toEqual({ domain: module.domain, summary: module.summary });
      }
    }
    expect(modules).toHaveLength(6);
  });
});

describe("transport capability gate", () => {
  class LimitedTransport extends FakeTransport {
    override capabilities(): TransportCapabilities {
      return {
        transport: "adb",
        tools: { "droid_capture.start_recording": "unsupported" },
        notes: { "droid_capture.start_recording": "Compositor capture is the candidate." },
      };
    }
  }

  it("refuses an unsupported tool with a structured error instead of a silent no-op", async () => {
    const transport = new LimitedTransport();
    const { ctx } = await createTestContext({ transport });

    const result = await invoke("droid_capture.start_recording", { targetId: "adb:TESTSERIAL01", name: "x" }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("unsupported_on_transport");
    expect(result.error.message).toMatch(/is unsupported on the adb transport\. Compositor capture/);
    expect(result.error.details).toMatchObject({ transport: "adb", capability: "droid_capture.start_recording" });
    expect(transport.spawned).toEqual([]);
  });

  it("passes a tool the transport does support", () => {
    const handle = {
      info: defaultTarget(),
      transport: new FakeTransport(),
      target: { targetId: "adb:X", transport: "adb" as const, serial: "X" },
    };
    expect(() => requireCapability(handle, "droid_input.tap")).not.toThrow();
  });
});

describe("transport registry", () => {
  it("looks up a transport by kind and reports an unregistered one", async () => {
    const registry = new TransportRegistry([new FakeTransport()]);
    expect(registry.get("adb")).toBeDefined();
    expect(registry.get("ssh")).toBeUndefined();
  });

  it("reports target_not_found when the matched target names an unregistered transport", async () => {
    const transport = new FakeTransport([defaultTarget({ targetId: "ssh:x", transport: "ssh" })]);
    const registry = new TransportRegistry([transport]);
    await expect(registry.resolve("ssh:x")).rejects.toMatchObject({ code: "target_not_found" });
  });
});

describe("shell quoting", () => {
  it("keeps a single quote inside a single-quoted argument", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("the real child-process runners", () => {
  it("captures stdout, stderr and a non-zero exit from a local command", async () => {
    const okRun = await nodeExecRunner({
      file: "node",
      args: ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      timeoutMs: 10_000,
      maxBytes: 1 << 20,
    });
    expect(okRun.stdout.toString()).toBe("out");
    expect(okRun.stderr).toBe("err");
    expect(okRun.exitCode).toBe(0);

    const failing = await nodeExecRunner({
      file: "node",
      args: ["-e", "process.exit(3)"],
      timeoutMs: 10_000,
      maxBytes: 1 << 20,
    });
    expect(failing.exitCode).toBe(3);
  });

  it("forwards stdin to the command", async () => {
    const run = await nodeExecRunner({
      file: "node",
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      timeoutMs: 10_000,
      maxBytes: 1 << 20,
      stdin: "piped payload",
    });
    expect(run.stdout.toString()).toBe("piped payload");
  });

  it("rejects when the binary does not exist", async () => {
    await expect(
      nodeExecRunner({
        file: path.join(os.tmpdir(), "droidctl-no-such-binary"),
        args: [],
        timeoutMs: 5_000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow();
  });

  it("spawns a detached child, collects its stderr and stops it on signal", async () => {
    const handle = nodeSpawnRunner({
      file: "node",
      args: ["-e", "process.stderr.write('started\\n'); setInterval(() => {}, 1000)"],
    });
    let stderr = "";
    handle.onStderr((chunk) => {
      stderr += chunk;
    });
    const closed = new Promise<number | null>((resolve) => handle.onClose(resolve));
    await new Promise((resolve) => setTimeout(resolve, 250));
    handle.kill("SIGTERM");
    expect(await closed).toBeNull();
    expect(stderr).toContain("started");
  });

  it("runs an end-to-end invocation through the default runner, with no adb binary involved", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "droidctl-fakeadb-"));
    const fakeAdb = path.join(dir, "adb");
    await writeFile(fakeAdb, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 });

    const transport = new AdbTransport({ adbPath: fakeAdb, defaultTimeoutMs: 10_000 });
    const result = await transport.exec({ targetId: "adb:X", transport: "adb", serial: "X" }, [
      "input",
      "tap",
      "1",
      "2",
    ]);

    expect(result.stdout.trim().split("\n")).toEqual(["-s", "X", "shell", "input", "tap", "1", "2"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("json results", () => {
  it("serialises the payload and repeats it as structured content", () => {
    const result = jsonResult({ a: 1 });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ a: 1 });
    expect(result.structuredContent).toEqual({ type: "json", data: { a: 1 } });
  });
});
