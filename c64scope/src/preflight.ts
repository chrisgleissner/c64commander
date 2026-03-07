import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Preflight check types
// ---------------------------------------------------------------------------

export interface PreflightCheck {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

export interface PreflightResult {
  ready: boolean;
  checks: PreflightCheck[];
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkAdbAvailable(): Promise<PreflightCheck> {
  try {
    const { stdout } = await execFileAsync("adb", ["version"]);
    return {
      name: "adb_available",
      status: "pass",
      detail: stdout.split("\n")[0]?.trim() ?? "adb found",
    };
  } catch {
    return {
      name: "adb_available",
      status: "fail",
      detail: "adb not found on PATH",
    };
  }
}

async function checkDeviceConnected(serial?: string): Promise<PreflightCheck> {
  try {
    const { stdout } = await execFileAsync("adb", ["devices", "-l"]);
    const lines = stdout.split("\n").filter((l) => l.includes("device") && !l.startsWith("List"));
    if (lines.length === 0) {
      return {
        name: "device_connected",
        status: "fail",
        detail: "No Android devices connected",
      };
    }
    if (serial) {
      const found = lines.some((l) => l.startsWith(serial));
      return {
        name: "device_connected",
        status: found ? "pass" : "fail",
        detail: found
          ? `Device ${serial} connected`
          : `Device ${serial} not found among: ${lines.map((l) => l.split(/\s+/)[0]).join(", ")}`,
      };
    }
    const firstSerial = lines[0]?.split(/\s+/)[0] ?? "unknown";
    return {
      name: "device_connected",
      status: "pass",
      detail: `Device ${firstSerial} connected`,
    };
  } catch {
    return {
      name: "device_connected",
      status: "fail",
      detail: "Failed to query adb devices",
    };
  }
}

async function checkC64uReachable(host: string): Promise<PreflightCheck> {
  try {
    const { stdout } = await execFileAsync("curl", ["-fsS", "--connect-timeout", "3", `http://${host}/v1/version`]);
    return {
      name: "c64u_reachable",
      status: "pass",
      detail: `C64U at ${host} responded (${stdout.length} bytes)`,
    };
  } catch {
    return {
      name: "c64u_reachable",
      status: "fail",
      detail: `C64U at ${host} not reachable`,
    };
  }
}

async function checkAppInstalled(serial?: string, packageName = "uk.gleissner.c64commander"): Promise<PreflightCheck> {
  try {
    const args = serial
      ? ["-s", serial, "shell", "pm", "list", "packages", packageName]
      : ["shell", "pm", "list", "packages", packageName];
    const { stdout } = await execFileAsync("adb", args);
    const found = stdout.includes(`package:${packageName}`);
    return {
      name: "app_installed",
      status: found ? "pass" : "fail",
      detail: found ? `${packageName} installed` : `${packageName} not installed`,
    };
  } catch {
    return {
      name: "app_installed",
      status: "fail",
      detail: `Failed to check if ${packageName} is installed`,
    };
  }
}

function checkNodeVersion(): PreflightCheck {
  const major = parseInt(process.version.slice(1), 10);
  return {
    name: "node_version",
    status: major >= 24 ? "pass" : "fail",
    detail: `Node.js ${process.version} (requires >=24)`,
  };
}

// ---------------------------------------------------------------------------
// Run all preflight checks
// ---------------------------------------------------------------------------

export interface PreflightOptions {
  deviceSerial?: string;
  c64uHost?: string;
  appPackage?: string;
  /** Skip hardware checks (for CI dry-run mode) */
  dryRun?: boolean;
}

export async function runPreflight(options: PreflightOptions = {}): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  checks.push(checkNodeVersion());

  if (options.dryRun) {
    checks.push({
      name: "adb_available",
      status: "skip",
      detail: "Skipped in dry-run mode",
    });
    checks.push({
      name: "device_connected",
      status: "skip",
      detail: "Skipped in dry-run mode",
    });
    checks.push({
      name: "c64u_reachable",
      status: "skip",
      detail: "Skipped in dry-run mode",
    });
    checks.push({
      name: "app_installed",
      status: "skip",
      detail: "Skipped in dry-run mode",
    });
  } else {
    checks.push(await checkAdbAvailable());
    checks.push(await checkDeviceConnected(options.deviceSerial));
    checks.push(await checkC64uReachable(options.c64uHost ?? "192.168.1.13"));
    checks.push(await checkAppInstalled(options.deviceSerial, options.appPackage));
  }

  const ready = checks.every((c) => c.status !== "fail");
  return { ready, checks };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const serial = process.env["ANDROID_SERIAL"];
  const host = process.env["C64U_HOST"];

  const result = await runPreflight({
    deviceSerial: serial,
    c64uHost: host,
    dryRun,
  });

  for (const check of result.checks) {
    const icon = check.status === "pass" ? "\u2713" : check.status === "skip" ? "-" : "\u2717";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  if (result.ready) {
    console.log("\nPreflight: READY");
  } else {
    console.log("\nPreflight: NOT READY");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Preflight failed:", error);
  process.exitCode = 1;
});
