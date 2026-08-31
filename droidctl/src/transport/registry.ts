/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TargetResolutionError } from "../tools/errors.js";
import type { ResolvedTarget, TargetInfo, Transport, TransportKind } from "./types.js";

export interface TransportListing {
  readonly targets: readonly TargetInfo[];
  readonly transportErrors: readonly { transport: TransportKind; message: string }[];
}

export interface ResolvedTargetHandle {
  readonly target: ResolvedTarget;
  readonly info: TargetInfo;
  readonly transport: Transport;
}

/**
 * Resolution has no default, no preference order and no "the only device" case.
 * Nothing here reduces a set of candidates to one by choosing; a set that is not
 * of size one is an error (spec §6.3 rules 1 to 5).
 */
export class TransportRegistry {
  private readonly transports: readonly Transport[];

  constructor(transports: readonly Transport[]) {
    this.transports = transports;
  }

  kinds(): TransportKind[] {
    return this.transports.map((transport) => transport.kind);
  }

  get(kind: TransportKind): Transport | undefined {
    return this.transports.find((transport) => transport.kind === kind);
  }

  async list(kinds?: readonly TransportKind[]): Promise<TransportListing> {
    const selected =
      kinds && kinds.length > 0 ? this.transports.filter((t) => kinds.includes(t.kind)) : this.transports;
    const targets: TargetInfo[] = [];
    const transportErrors: { transport: TransportKind; message: string }[] = [];

    for (const transport of selected) {
      try {
        targets.push(...(await transport.listTargets()));
      } catch (error) {
        transportErrors.push({
          transport: transport.kind,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { targets, transportErrors };
  }

  async resolve(targetId: string): Promise<ResolvedTargetHandle> {
    const listing = await this.list();
    const matches = listing.targets.filter((target) => target.targetId === targetId);

    if (matches.length === 0) {
      throw new TargetResolutionError(
        `No target with id ${JSON.stringify(targetId)} is connected. Call droid_target.list_targets and pass an id it returned.`,
        "target_not_found",
        {
          targetId,
          availableTargetIds: listing.targets.map((target) => target.targetId),
          transportErrors: listing.transportErrors,
        },
      );
    }

    if (matches.length > 1) {
      throw new TargetResolutionError(
        `Target id ${JSON.stringify(targetId)} matches ${matches.length} devices. Disconnect one, or address them by distinct ids.`,
        "ambiguous_target",
        { targetId, candidates: matches },
      );
    }

    const info = matches[0]!;
    const transport = this.get(info.transport);
    if (!transport) {
      throw new TargetResolutionError(
        `Target ${targetId} names transport ${info.transport}, which is not registered.`,
        "target_not_found",
        { targetId, registeredTransports: this.kinds() },
      );
    }

    return {
      info,
      transport,
      target: { targetId: info.targetId, transport: info.transport, serial: info.serial },
    };
  }
}
