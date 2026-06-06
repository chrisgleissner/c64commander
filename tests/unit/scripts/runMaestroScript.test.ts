/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/run-maestro.sh");

describe("run-maestro.sh", () => {
  it("lets explicit tag or single-flow selection bypass default slow exclusions", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('parse_tag_filters "$TAG_FILTERS"');
    expect(script).toContain('if [[ -n "$TAG_INCLUDE" || -n "$FLOW_PATH" ]]; then');
    expect(script).toContain('strip_exclude_tags "$CONFIG_PATH" "$TEMP_CONFIG"');
    expect(script).toContain('MAESTRO_ARGS+=(--config "$TEMP_CONFIG")');
  });

  it("supports no-reset local playback proof by staging fixtures without clearing app data", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("LOCAL_SOURCE_FIXTURE_DIR");
    expect(script).toContain("is_local_binary_playback_selected()");
    expect(script).toContain('ensure_local_source_fixtures "$DEVICE_ID"');
    expect(script).toContain("pm clear com.google.android.documentsui");
    expect(script).toContain("localSourceInitialUri");
    expect(script).toContain("resetLocalSourcePermissions");
    expect(script).toContain("if(resetLocalSourcePermissions){payload.resetLocalSourcePermissions=true;}");
    expect(script).toContain("elif is_local_binary_playback_selected; then\n  write_smoke_config");
  });

  it("points the local playback picker at the staged fixture folder", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('local relative="${target_dir#/sdcard/}"');
    expect(script).not.toContain('parent_dir="${target_dir%/*}"');
  });

  it("accepts an explicit Maestro flow path", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("--flow <path>");
    expect(script).toContain("resolve_flow_path()");
    expect(script).toContain('MAESTRO_TARGET="$FLOW_PATH"');
  });

  it("does not treat the runner invocation as a stale Maestro process", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('self="$$"');
    expect(script).toContain('parent="$PPID"');
    expect(script).toContain("$0 !~ /run-maestro\\.sh/");
  });
});
