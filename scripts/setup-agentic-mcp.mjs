#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
const codexUserConfigPath = path.join(codexHome, "config.toml");
const claudeUserConfigPath = path.join(os.homedir(), ".claude.json");

const serverNames = ["mobile-mcp", "droidmind", "c64bridge", "c64scope"];
const managedStart = "# BEGIN C64 Commander agentic MCP servers";
const managedEnd = "# END C64 Commander agentic MCP servers";

const sharedServers = {
  "mobile-mcp": {
    type: "stdio",
    command: "npx",
    args: ["-y", "@mobilenext/mobile-mcp@latest"],
    env: {},
  },
  droidmind: {
    type: "stdio",
    command: "uvx",
    args: ["--from", "git+https://github.com/hyperb1iss/droidmind", "droidmind", "--transport", "stdio"],
    env: {},
  },
  c64bridge: {
    type: "stdio",
    command: "npx",
    args: ["-y", "c64bridge@latest"],
    env: {},
  },
  c64scope: {
    type: "stdio",
    command: "node",
    args: ["c64scope/scripts/start.mjs"],
    env: {},
  },
};

const usage = `Usage: node scripts/setup-agentic-mcp.mjs [--check] [--check-user]

Synchronizes the agentic-testing MCP server config for Claude Code, VS Code MCP,
and Codex. By default it updates checked-in project config, the active Codex
user config at \${CODEX_HOME:-~/.codex}/config.toml, and Claude Code's local
project config.

Options:
  --check       Verify checked-in project config without writing files.
  --check-user  With --check, also verify active Codex and Claude Code user config.
  -h, --help    Show this help.
`;

const args = new Set(process.argv.slice(2));

if (args.has("-h") || args.has("--help")) {
  process.stdout.write(usage);
  process.exit(0);
}

const unknownArgs = [...args].filter((arg) => arg !== "--check" && arg !== "--check-user");

if (unknownArgs.length > 0) {
  process.stderr.write(`Unknown option(s): ${unknownArgs.join(", ")}\n\n${usage}`);
  process.exit(2);
}

const checkOnly = args.has("--check");
const checkUser = args.has("--check-user");

const stableJson = (value) =>
  format(JSON.stringify(value), {
    parser: "json",
    printWidth: 120,
  });

const claudeProjectConfig = await stableJson({ mcpServers: sharedServers });

const vscodeProjectConfig = await stableJson({
  servers: Object.fromEntries(
    Object.entries(sharedServers).map(([name, server]) => [
      name,
      {
        type: server.type,
        command: server.command,
        args: server.args,
      },
    ]),
  ),
});

const tomlString = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const tomlArray = (values) => `[${values.map(tomlString).join(", ")}]`;

const tomlHeaderName = (name) => (/^[A-Za-z0-9_]+$/.test(name) ? name : tomlString(name));

const codexTomlSections = (servers) =>
  Object.entries(servers)
    .map(([name, server]) => {
      const lines = [
        `[mcp_servers.${tomlHeaderName(name)}]`,
        `command = ${tomlString(server.command)}`,
        `args = ${tomlArray(server.args)}`,
      ];

      return lines.join("\n");
    })
    .join("\n\n");

const projectCodexConfig = `${codexTomlSections(sharedServers)}\n`;

const absoluteCodexServers = {
  ...sharedServers,
  c64scope: {
    ...sharedServers.c64scope,
    args: [path.join(projectRoot, "c64scope/scripts/start.mjs")],
  },
};

const codexManagedBlock = `${managedStart}\n${codexTomlSections(absoluteCodexServers)}\n${managedEnd}\n`;

const readTextIfExists = (filePath) => (existsSync(filePath) ? readFileSync(filePath, "utf8") : "");

const ensureMatches = (filePath, expected) => {
  const current = readTextIfExists(filePath);
  if (current !== expected) {
    throw new Error(`${filePath} is not synchronized`);
  }
};

const writeIfChanged = (filePath, content) => {
  const current = readTextIfExists(filePath);
  if (current === content) {
    return false;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return true;
};

const isManagedCodexHeader = (line) => {
  const match = line.match(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/);
  return match ? serverNames.includes(match[1] ?? match[2]) : false;
};

const stripCodexServerSections = (text) => {
  const lines = text.split(/\r?\n/);
  const kept = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!isManagedCodexHeader(line)) {
      kept.push(line);
      continue;
    }

    while (index + 1 < lines.length && !lines[index + 1].startsWith("[")) {
      index += 1;
    }
  }

  return `${kept.join("\n").trimEnd()}\n`;
};

const stripManagedBlock = (text) => {
  const start = text.indexOf(managedStart);
  if (start === -1) {
    return text;
  }

  const end = text.indexOf(managedEnd, start);
  if (end === -1) {
    throw new Error(`Unterminated managed MCP block in ${codexUserConfigPath}`);
  }

  return `${text.slice(0, start)}${text.slice(end + managedEnd.length)}`;
};

const withManagedCodexBlock = (text) => {
  const base = stripCodexServerSections(stripManagedBlock(text)).trimEnd();
  return `${base ? `${base}\n\n` : ""}${codexManagedBlock}`;
};

const assertClaudeLocalConfig = () => {
  const config = JSON.parse(readTextIfExists(claudeUserConfigPath) || "{}");
  const projectServers = config.projects?.[projectRoot]?.mcpServers ?? {};

  for (const [name, server] of Object.entries(sharedServers)) {
    if (JSON.stringify(projectServers[name]) !== JSON.stringify(server)) {
      throw new Error(`${claudeUserConfigPath} is missing local MCP server ${name}`);
    }
  }
};

const getClaudeLocalServers = () => {
  const config = JSON.parse(readTextIfExists(claudeUserConfigPath) || "{}");
  return config.projects?.[projectRoot]?.mcpServers ?? {};
};

const installClaudeLocalConfig = () => {
  const changed = [];

  for (const [name, server] of Object.entries(sharedServers)) {
    const currentServer = getClaudeLocalServers()[name];
    if (JSON.stringify(currentServer) === JSON.stringify(server)) {
      continue;
    }

    if (currentServer) {
      const removeResult = spawnSync("claude", ["mcp", "remove", "-s", "local", name], {
        cwd: projectRoot,
        encoding: "utf8",
      });

      if (removeResult.error) {
        throw new Error(`Failed to remove stale Claude Code MCP setup for ${name}: ${removeResult.error.message}`);
      }

      if (removeResult.status !== 0) {
        throw new Error(
          `Removing stale Claude Code MCP setup for ${name} exited with status ${removeResult.status ?? 1}\n${removeResult.stderr}${removeResult.stdout}`,
        );
      }
    }

    const result = spawnSync("claude", ["mcp", "add-json", "-s", "local", name, JSON.stringify(server)], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    if (result.error) {
      throw new Error(`Failed to run Claude Code MCP setup for ${name}: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(
        `Claude Code MCP setup for ${name} exited with status ${result.status ?? 1}\n${result.stderr}${result.stdout}`,
      );
    }

    if (result.stdout.includes("Added ")) {
      changed.push(name);
    }
  }

  return changed;
};

try {
  const projectFiles = [
    [path.join(projectRoot, ".mcp.json"), claudeProjectConfig],
    [path.join(projectRoot, ".vscode/mcp.json"), vscodeProjectConfig],
    [path.join(projectRoot, "config.toml"), projectCodexConfig],
  ];

  if (checkOnly) {
    for (const [filePath, expected] of projectFiles) {
      ensureMatches(filePath, expected);
    }

    if (checkUser) {
      const currentCodexConfig = readTextIfExists(codexUserConfigPath);
      if (withManagedCodexBlock(currentCodexConfig) !== currentCodexConfig) {
        throw new Error(`${codexUserConfigPath} is not synchronized`);
      }

      assertClaudeLocalConfig();
    }

    process.stdout.write("Agentic MCP configuration is synchronized.\n");
    process.exit(0);
  }

  const changedFiles = [];

  for (const [filePath, expected] of projectFiles) {
    if (writeIfChanged(filePath, expected)) {
      changedFiles.push(filePath);
    }
  }

  const nextCodexConfig = withManagedCodexBlock(readTextIfExists(codexUserConfigPath));
  if (writeIfChanged(codexUserConfigPath, nextCodexConfig)) {
    changedFiles.push(codexUserConfigPath);
  }

  const changedClaudeServers = installClaudeLocalConfig();
  if (changedClaudeServers.length > 0) {
    changedFiles.push(`${claudeUserConfigPath} [project: ${projectRoot}]`);
  }

  if (changedFiles.length === 0) {
    process.stdout.write("Agentic MCP configuration was already synchronized.\n");
  } else {
    process.stdout.write(
      `Synchronized agentic MCP configuration:\n${changedFiles.map((filePath) => `- ${filePath}`).join("\n")}\n`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
