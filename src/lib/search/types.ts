/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DeviceCapabilities } from "@/lib/deviceCapabilities";

/** The capability predicates a search entry may gate on. Booleans on DeviceCapabilities only. */
export type DeviceCapabilityKey = {
  [K in keyof DeviceCapabilities]: DeviceCapabilities[K] extends boolean ? K : never;
}[keyof DeviceCapabilities];

export type SearchGroup = "action" | "page" | "setting" | "config" | "music" | "disk" | "docs";

export type SearchTarget =
  /** A tab or sub-route. */
  | { kind: "route"; path: string }
  /** A collapsible section: navigate, open it, scroll to it. */
  | { kind: "section"; path: string; scope: string; id: string }
  /** A control inside a section: navigate, open the section, scroll to and focus the control. */
  | { kind: "control"; path: string; scope: string; sectionId: string; testId: string }
  /** A live device config item: navigate to Config, open the category, scroll to the item. */
  | { kind: "configItem"; category: string; itemName: string }
  /** Something the app does rather than somewhere it goes. Resolved via the handler map. */
  | { kind: "action"; handlerId: string };

/**
 * A named precondition, evaluated at query time against the live app. Never baked into the
 * generated index: the build machine does not know this user's flags, variant, hardware or
 * firmware. Adding a kind is a change in exactly two places, this union and the resolver, and
 * `requirements.test.ts` asserts the resolver covers every member.
 */
export type SearchRequirement =
  /** A connected C64 Ultimate. */
  | { kind: "device" }
  /** A capability the connected device actually reports, e.g. supportsStreaming. */
  | { kind: "capability"; capability: DeviceCapabilityKey }
  /** Surfaces that only exist on some product families. */
  | { kind: "productFamily"; families: readonly string[] }
  /** A Telnet-backed action, which needs Telnet reachable as well as a device. */
  | { kind: "telnet" }
  | { kind: "flag"; flag: string }
  | { kind: "variant"; variant: string }
  /** The HVSC archive is installed. */
  | { kind: "hvsc" }
  /** A restorable playback session exists. */
  | { kind: "session" };

export interface SearchEntry {
  /** Stable and unique. Persisted in the recently-picked list, so it must not change per build. */
  readonly id: string;
  /** Translation key plus English default, in the shape `t()` already takes. */
  readonly titleKey: string;
  readonly titleDefault: string;
  readonly subtitleKey?: string;
  readonly subtitleDefault?: string;
  /** Words a user might type that are not in the title. English only; not translated yet. */
  readonly keywords?: readonly string[];
  readonly group: SearchGroup;
  readonly target: SearchTarget;
  readonly iconId?: string;
  readonly requires?: readonly SearchRequirement[];
}

/** The outcome of evaluating one requirement, and what a disabled row shows. */
export interface RequirementVerdict {
  readonly met: boolean;
  readonly reason: string;
  /** Where the user can go to satisfy it, when that is a place in the app. */
  readonly remedyTarget?: SearchTarget;
}

/** An entry with its requirements already evaluated, ready to score and render. */
export interface ResolvedSearchEntry {
  readonly entry: SearchEntry;
  readonly enabled: boolean;
  /** Null when every requirement is met. */
  readonly disabledReason: string | null;
  readonly remedyTarget?: SearchTarget;
}
