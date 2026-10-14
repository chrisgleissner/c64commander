/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "node:child_process";
import { createLogger } from "../logger.js";
import type { Tunnel } from "./sshProbe.js";

export const EXIT_DISCONNECT_TIMEOUT_MS = 5_000;

export interface TunnelReaperDeps {
  /** Runs a command to completion before returning, because it runs inside a process 'exit' listener. */
  readonly runSync: (argv: readonly string[]) => void;
  readonly onProcessExit: (listener: () => void) => void;
  readonly warn: (message: string, details: Record<string, unknown>) => void;
}

const logger = createLogger("droidctl");

export const nodeTunnelReaperDeps: TunnelReaperDeps = {
  runSync: (argv) => {
    execFileSync(argv[0]!, argv.slice(1), { stdio: "ignore", timeout: EXIT_DISCONNECT_TIMEOUT_MS });
  },
  onProcessExit: (listener) => {
    process.once("exit", listener);
  },
  warn: (message, details) => logger.warn(message, details),
};

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * The tunnels this process opened and has not closed. Node runs only synchronous
 * code in an 'exit' listener, so at exit each one is ended with a signal and a
 * blocking `adb disconnect`, and no ssh process outlives the process that opened it.
 */
export class TunnelReaper {
  private readonly deps: TunnelReaperDeps;
  private readonly live = new Map<Tunnel, readonly string[]>();
  private exitListenerRegistered = false;

  constructor(deps: TunnelReaperDeps) {
    this.deps = deps;
  }

  track(tunnel: Tunnel, disconnectArgv: readonly string[]): void {
    if (!this.exitListenerRegistered) {
      this.exitListenerRegistered = true;
      this.deps.onProcessExit(() => this.reap());
    }
    this.live.set(tunnel, disconnectArgv);
  }

  forget(tunnel: Tunnel): void {
    this.live.delete(tunnel);
  }

  liveCount(): number {
    return this.live.size;
  }

  reap(): void {
    for (const [tunnel, disconnectArgv] of this.live) {
      if (!tunnel.closed) {
        try {
          tunnel.handle.kill("SIGTERM");
        } catch (error) {
          this.deps.warn("Could not stop an ssh tunnel at process exit", {
            serial: tunnel.serial,
            argv: tunnel.argv,
            error: describeError(error),
          });
        }
      }
      try {
        this.deps.runSync(disconnectArgv);
      } catch (error) {
        this.deps.warn("Could not disconnect an ssh tunnel from the adb server at process exit", {
          serial: tunnel.serial,
          argv: disconnectArgv,
          error: describeError(error),
        });
      }
    }
    this.live.clear();
  }
}

/** One per process, so the 'exit' listener is registered once however many transports open tunnels. */
export const processTunnelReaper = new TunnelReaper(nodeTunnelReaperDeps);
