/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";
import { z } from "zod";
import { TransportUnavailableError } from "../tools/errors.js";
import { DEFAULT_SSH_PORT, type SshEndpoint } from "./sshCommands.js";
import { sshConfigInvalid } from "./sshPrerequisites.js";

export const DEFAULT_SSH_USER = "defaultuser";
/** The address such a phone conventionally takes on its USB network link. */
export const DEFAULT_USB_HOST = "192.168.2.15";

/** Every setting a caller can change without code, with what it does. Served as a resource. */
export const CONFIG_VARIABLES: Readonly<Record<string, string>> = {
  DROIDCTL_SSH_CONFIG:
    "Path of the JSON configuration file. Default $XDG_CONFIG_HOME/droidctl/ssh.json or ~/.config/droidctl/ssh.json.",
  DROIDCTL_SSH_DISCOVERY:
    "off disables discovery over USB network interfaces; configured hosts are still probed. Default on.",
  DROIDCTL_SSH_HOSTS: "Comma-separated [user@]host[:port] entries probed in addition to discovered ones.",
  DROIDCTL_SSH_USER: "Login user for discovered and listed hosts. Default defaultuser.",
  DROIDCTL_SSH_PORT: "SSH port. Default 22.",
  DROIDCTL_SSH_IDENTITY: "Private key file passed to ssh with IdentitiesOnly. Default: ssh's own choice.",
  DROIDCTL_SSH_ATTACH_COMMAND:
    "Command that runs a program inside the container, such as lxc-attach -n <name> --. Replaces detection.",
  DROIDCTL_SSH_CONTAINER_ADB:
    "address:port of the container's adbd as seen from the phone. Tried before detected endpoints.",
};

export interface SshHostSettings extends SshEndpoint {
  /** Replaces attach-command detection when set. */
  readonly attachCommand: readonly string[] | null;
  /** `address:port` of the container's adbd as seen from the phone; tried before any detected endpoint. */
  readonly containerAdb: string | null;
}

export interface ConfiguredHost {
  readonly settings: SshHostSettings;
  readonly source: string;
}

export interface SshTransportConfig {
  readonly discovery: boolean;
  readonly defaults: Omit<SshHostSettings, "host">;
  readonly hosts: readonly ConfiguredHost[];
}

export interface ConfigSources {
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: string;
  readText(filePath: string): string | null;
}

const endpointPattern = /^[A-Za-z0-9.-]+:\d{1,5}$/;

const hostFields = {
  user: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().min(1).optional(),
  attachCommand: z.array(z.string().min(1)).min(1).optional(),
  containerAdb: z.string().regex(endpointPattern, "must be address:port").optional(),
};

const configFileSchema = z
  .object({
    discovery: z.boolean().optional(),
    defaults: z.object(hostFields).strict().optional(),
    hosts: z.array(z.object({ host: z.string().min(1), ...hostFields }).strict()).optional(),
  })
  .strict();

type HostOverrides = z.infer<z.ZodObject<typeof hostFields>>;

/** Splits a command line on whitespace, honouring single and double quotes, without expanding anything. */
export function splitCommandWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const character of value) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }
  if (quote !== null) {
    throw new Error(`unterminated ${quote} quote in ${JSON.stringify(value)}`);
  }
  if (started) {
    words.push(current);
  }
  return words;
}

export function expandHome(filePath: string, homeDir: string): string {
  return filePath === "~" || filePath.startsWith("~/") ? path.join(homeDir, filePath.slice(1)) : filePath;
}

/** `[user@]host[:port]`, with the defaults filling whatever the spec leaves out. */
export function parseHostSpec(spec: string, defaults: Omit<SshHostSettings, "host">): SshHostSettings {
  const match = /^(?:([^@\s]+)@)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(spec.trim());
  const port = match?.[3] === undefined ? defaults.port : Number(match[3]);
  if (!match || port < 1 || port > 65535) {
    throw new Error(`${JSON.stringify(spec)} is not [user@]host[:port]`);
  }
  return { ...defaults, host: match[2]!, user: match[1] ?? defaults.user, port };
}

function applyOverrides(
  base: Omit<SshHostSettings, "host">,
  overrides: HostOverrides,
  homeDir: string,
): Omit<SshHostSettings, "host"> {
  return {
    user: overrides.user ?? base.user,
    port: overrides.port ?? base.port,
    identityFile:
      overrides.identityFile === undefined ? base.identityFile : expandHome(overrides.identityFile, homeDir),
    attachCommand: overrides.attachCommand ?? base.attachCommand,
    containerAdb: overrides.containerAdb ?? base.containerAdb,
  };
}

function envOverrides(env: NodeJS.ProcessEnv): HostOverrides {
  const overrides: HostOverrides = {};
  if (env["DROIDCTL_SSH_USER"]) overrides.user = env["DROIDCTL_SSH_USER"];
  if (env["DROIDCTL_SSH_PORT"]) {
    const port = Number(env["DROIDCTL_SSH_PORT"]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`DROIDCTL_SSH_PORT=${JSON.stringify(env["DROIDCTL_SSH_PORT"])} is not a TCP port`);
    }
    overrides.port = port;
  }
  if (env["DROIDCTL_SSH_IDENTITY"]) overrides.identityFile = env["DROIDCTL_SSH_IDENTITY"];
  if (env["DROIDCTL_SSH_ATTACH_COMMAND"]) {
    const words = splitCommandWords(env["DROIDCTL_SSH_ATTACH_COMMAND"]);
    if (words.length === 0) {
      throw new Error("DROIDCTL_SSH_ATTACH_COMMAND is blank");
    }
    overrides.attachCommand = words;
  }
  if (env["DROIDCTL_SSH_CONTAINER_ADB"]) {
    if (!endpointPattern.test(env["DROIDCTL_SSH_CONTAINER_ADB"])) {
      throw new Error("DROIDCTL_SSH_CONTAINER_ADB must be address:port");
    }
    overrides.containerAdb = env["DROIDCTL_SSH_CONTAINER_ADB"];
  }
  return overrides;
}

function parseDiscovery(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (/^(off|0|false|no)$/i.test(value)) {
    return false;
  }
  if (/^(on|1|true|yes)$/i.test(value)) {
    return true;
  }
  throw new Error(`DROIDCTL_SSH_DISCOVERY=${JSON.stringify(value)} is not on or off`);
}

export function defaultConfigPath(sources: Pick<ConfigSources, "env" | "homeDir">): string {
  const base = sources.env["XDG_CONFIG_HOME"] || path.join(sources.homeDir, ".config");
  return path.join(base, "droidctl", "ssh.json");
}

/**
 * Built-in defaults, then the file's defaults, then DROIDCTL_SSH_* variables. A
 * host listed in the file keeps its own fields over both. The default file may be
 * absent; a file named by DROIDCTL_SSH_CONFIG must exist.
 */
export function resolveSshConfig(sources: ConfigSources): SshTransportConfig {
  const explicitPath = sources.env["DROIDCTL_SSH_CONFIG"];
  const filePath = explicitPath ? expandHome(explicitPath, sources.homeDir) : defaultConfigPath(sources);
  let source = filePath;
  try {
    const text = sources.readText(filePath);
    if (text === null && explicitPath) {
      throw new Error("the file does not exist or cannot be read");
    }
    const file = text === null ? {} : configFileSchema.parse(JSON.parse(text));

    const builtIn: Omit<SshHostSettings, "host"> = {
      user: DEFAULT_SSH_USER,
      port: DEFAULT_SSH_PORT,
      identityFile: null,
      attachCommand: null,
      containerAdb: null,
    };
    source = "the DROIDCTL_SSH_* environment variables";
    const env = envOverrides(sources.env);
    const defaults = applyOverrides(
      applyOverrides(builtIn, file.defaults ?? {}, sources.homeDir),
      env,
      sources.homeDir,
    );
    const discovery = parseDiscovery(sources.env["DROIDCTL_SSH_DISCOVERY"], file.discovery ?? true);

    const hosts: ConfiguredHost[] = (file.hosts ?? []).map(({ host, ...overrides }) => ({
      settings: { host, ...applyOverrides(defaults, overrides, sources.homeDir) },
      source: filePath,
    }));
    for (const spec of (sources.env["DROIDCTL_SSH_HOSTS"] ?? "").split(",").filter((s) => s.trim().length > 0)) {
      hosts.push({ settings: parseHostSpec(spec, defaults), source: "DROIDCTL_SSH_HOSTS" });
    }
    return { discovery, defaults, hosts };
  } catch (error) {
    // Everything thrown above is an Error: JSON.parse, zod, or the checks in this file.
    const problem =
      error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
        : (error as Error).message;
    const missing = sshConfigInvalid(source, problem);
    throw new TransportUnavailableError("ssh", missing.message, { prerequisites: [missing] });
  }
}
