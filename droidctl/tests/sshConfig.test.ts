/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  type ConfigSources,
  DEFAULT_SSH_USER,
  defaultConfigPath,
  expandHome,
  parseHostSpec,
  resolveSshConfig,
  splitCommandWords,
} from "../src/transport/sshConfig.js";

function sources(env: NodeJS.ProcessEnv = {}, files: Record<string, string> = {}): ConfigSources {
  return { env, homeDir: "/home/me", readText: (filePath) => files[filePath] ?? null };
}

function configError(run: () => unknown): { code: string; message: string; details: any } {
  try {
    run();
  } catch (error) {
    return error as { code: string; message: string; details: any };
  }
  throw new Error("expected resolveSshConfig to throw");
}

const DEFAULT_FILE = "/home/me/.config/droidctl/ssh.json";

describe("ssh configuration", () => {
  it("defaults to discovery on, the conventional login user and port 22, with no file present", () => {
    expect(resolveSshConfig(sources())).toEqual({
      discovery: true,
      defaults: { user: DEFAULT_SSH_USER, port: 22, identityFile: null, attachCommand: null, containerAdb: null },
      hosts: [],
    });
  });

  it("layers file defaults under environment variables, and lets a listed host keep its own fields", () => {
    const file = JSON.stringify({
      discovery: false,
      defaults: { user: "fileuser", port: 2200, identityFile: "~/.ssh/phone" },
      hosts: [{ host: "10.0.0.5", port: 2300, attachCommand: ["lxc-attach", "-n", "a", "--"] }],
    });
    const config = resolveSshConfig(
      sources(
        {
          DROIDCTL_SSH_USER: "envuser",
          DROIDCTL_SSH_CONTAINER_ADB: "127.0.0.1:5555",
          DROIDCTL_SSH_HOSTS: "root@10.0.0.6:2022, 10.0.0.7 ,",
          DROIDCTL_SSH_DISCOVERY: "on",
        },
        { [DEFAULT_FILE]: file },
      ),
    );

    expect(config.discovery).toBe(true);
    expect(config.defaults).toEqual({
      user: "envuser",
      port: 2200,
      identityFile: "/home/me/.ssh/phone",
      attachCommand: null,
      containerAdb: "127.0.0.1:5555",
    });
    expect(config.hosts).toEqual([
      {
        settings: {
          host: "10.0.0.5",
          user: "envuser",
          port: 2300,
          identityFile: "/home/me/.ssh/phone",
          attachCommand: ["lxc-attach", "-n", "a", "--"],
          containerAdb: "127.0.0.1:5555",
        },
        source: DEFAULT_FILE,
      },
      {
        settings: expect.objectContaining({ host: "10.0.0.6", user: "root", port: 2022 }),
        source: "DROIDCTL_SSH_HOSTS",
      },
      {
        settings: expect.objectContaining({ host: "10.0.0.7", user: "envuser", port: 2200 }),
        source: "DROIDCTL_SSH_HOSTS",
      },
    ]);
  });

  it("reads the file named by DROIDCTL_SSH_CONFIG or under XDG_CONFIG_HOME, and takes the rest from the environment", () => {
    const explicit = resolveSshConfig(
      sources(
        {
          DROIDCTL_SSH_CONFIG: "~/phones.json",
          DROIDCTL_SSH_PORT: "2222",
          DROIDCTL_SSH_IDENTITY: "/keys/id",
          DROIDCTL_SSH_ATTACH_COMMAND: `helper --name "my container" --`,
        },
        { "/home/me/phones.json": JSON.stringify({ defaults: { user: "fromfile" } }) },
      ),
    );
    expect(explicit.defaults).toEqual({
      user: "fromfile",
      port: 2222,
      identityFile: "/keys/id",
      attachCommand: ["helper", "--name", "my container", "--"],
      containerAdb: null,
    });
    expect(defaultConfigPath({ env: { XDG_CONFIG_HOME: "/xdg" }, homeDir: "/home/me" })).toBe("/xdg/droidctl/ssh.json");
    expect(resolveSshConfig(sources({ DROIDCTL_SSH_DISCOVERY: "off" })).discovery).toBe(false);
  });

  it("reports every invalid input as ssh-config, naming where it came from", () => {
    const cases: [ConfigSources, RegExp][] = [
      [sources({ DROIDCTL_SSH_CONFIG: "/missing.json" }), /from \/missing\.json is invalid: the file does not exist/],
      [sources({}, { [DEFAULT_FILE]: "{not json" }), /from \/home\/me\/\.config\/droidctl\/ssh\.json is invalid/],
      [sources({}, { [DEFAULT_FILE]: JSON.stringify({ hosts: [{ host: "x", port: 0 }] }) }), /hosts\.0\.port/],
      [sources({}, { [DEFAULT_FILE]: JSON.stringify({ bogus: true }) }), /\(root\): Unrecognized key/],
      [sources({ DROIDCTL_SSH_PORT: "70000" }), /environment variables is invalid: DROIDCTL_SSH_PORT="70000"/],
      [sources({ DROIDCTL_SSH_ATTACH_COMMAND: "  " }), /DROIDCTL_SSH_ATTACH_COMMAND is blank/],
      [sources({ DROIDCTL_SSH_ATTACH_COMMAND: "helper 'open" }), /unterminated ' quote/],
      [sources({ DROIDCTL_SSH_CONTAINER_ADB: "localhost" }), /DROIDCTL_SSH_CONTAINER_ADB must be address:port/],
      [sources({ DROIDCTL_SSH_DISCOVERY: "maybe" }), /DROIDCTL_SSH_DISCOVERY="maybe" is not on or off/],
      [sources({ DROIDCTL_SSH_HOSTS: "user@@host" }), /"user@@host" is not \[user@\]host\[:port\]/],
    ];
    for (const [input, pattern] of cases) {
      const error = configError(() => resolveSshConfig(input));
      expect(error.code).toBe("transport_unavailable");
      expect(error.message).toMatch(pattern);
      expect(error.details.prerequisites[0].id).toBe("ssh-config");
    }
  });
});

describe("configuration helpers", () => {
  it("splits command words with quotes and without expansion", () => {
    expect(splitCommandWords(`  a  'b c' "d 'e'" f"g h"i '' `)).toEqual(["a", "b c", "d 'e'", "fg hi", ""]);
    expect(splitCommandWords("")).toEqual([]);
  });

  it("parses host specs and rejects a port outside the TCP range", () => {
    const defaults = { user: "u", port: 22, identityFile: null, attachCommand: null, containerAdb: null };
    expect(parseHostSpec("h", defaults)).toMatchObject({ host: "h", user: "u", port: 22 });
    expect(parseHostSpec("a@h.example:2", defaults)).toMatchObject({ host: "h.example", user: "a", port: 2 });
    expect(() => parseHostSpec("h:0", defaults)).toThrow(/not \[user@\]host/);
    expect(() => parseHostSpec("h:99999", defaults)).toThrow(/not \[user@\]host/);
  });

  it("expands only a leading tilde", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/k", "/home/me")).toBe("/home/me/k");
    expect(expandHome("/abs/~/k", "/home/me")).toBe("/abs/~/k");
  });
});
