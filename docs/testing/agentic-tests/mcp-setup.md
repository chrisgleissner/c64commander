# Agentic MCP Setup

Agentic hardware-in-the-loop testing uses the peer MCP servers named in the
agentic-test docs and in `docs/plans/hardening/ralph/ralph.md`:

| Server       | Role                                                                        | Launcher                                                                             |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `droidmind`  | Android app controller for Pixel 4 product validation                       | `uvx --from git+https://github.com/hyperb1iss/droidmind droidmind --transport stdio` |
| `c64scope`   | Physical A/V, UDP stream, timing, timeline, and artifact oracle             | `node c64scope/scripts/start.mjs`                                                    |
| `c64bridge`  | Narrow C64U/U64 setup, state, stream, calibration, and emergency gap filler | `npx -y c64bridge@latest`                                                            |
| `mobile-mcp` | Future-compatible mobile controller option                                  | `npx -y @mobilenext/mobile-mcp@latest`                                               |

## Shared Project Config

- Claude Code reads `.mcp.json`.
- VS Code MCP reads `.vscode/mcp.json`.
- The project-local Codex profile lives in `config.toml` and can be inspected with:

```bash
CODEX_HOME="$PWD" codex mcp list
```

Codex normal runs read `${CODEX_HOME:-~/.codex}/config.toml`, not this repository's
`config.toml`. Install the same server definitions into the active Codex user
config and into Claude Code's local project config with:

```bash
npm run agentic:mcp:setup
```

That command also synchronizes `.mcp.json`, `.vscode/mcp.json`, and `config.toml`
from one server list in `scripts/setup-agentic-mcp.mjs`.

Check the checked-in project config without touching user config:

```bash
npm run agentic:mcp:check
```

Check the active Codex user config and Claude Code local project config as well:

```bash
node scripts/setup-agentic-mcp.mjs --check --check-user
```

## Client Verification

After setup:

```bash
codex mcp list
claude mcp list
```

Claude Code may show shared project `.mcp.json` servers as pending until the user
approves them in an interactive `claude` session. `npm run agentic:mcp:setup`
also installs matching local project entries so this checkout can use the servers
without waiting for shared-config approval.

Codex should list all four servers directly after `npm run agentic:mcp:setup`.

## c64scope Launcher

Both clients use `node c64scope/scripts/start.mjs` for `c64scope`. The launcher
locates the repository-local `c64scope` package, installs its runtime dependencies
if they are missing, then starts the TypeScript MCP server through `tsx`.
