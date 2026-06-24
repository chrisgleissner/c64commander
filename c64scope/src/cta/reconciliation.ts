/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface InventoryItem {
  fingerprint: string;
  route: string;
  label?: string;
  role?: string;
}

export interface InventoryReconciliation {
  documentedButNotFound: InventoryItem[];
  foundButUndocumented: InventoryItem[];
  changedTypeOrLabel: Array<{ documented: InventoryItem; runtime: InventoryItem }>;
  duplicates: InventoryItem[];
}

function byFingerprint(items: readonly InventoryItem[]): Map<string, InventoryItem> {
  return new Map(items.map((item) => [item.fingerprint, item]));
}

function duplicateItems(items: readonly InventoryItem[]): InventoryItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.fingerprint, (counts.get(item.fingerprint) ?? 0) + 1);
  }
  return items.filter((item) => (counts.get(item.fingerprint) ?? 0) > 1);
}

export function reconcileInventories(
  documented: readonly InventoryItem[],
  runtime: readonly InventoryItem[],
): InventoryReconciliation {
  const documentedByFingerprint = byFingerprint(documented);
  const runtimeByFingerprint = byFingerprint(runtime);
  const documentedButNotFound = documented.filter((item) => !runtimeByFingerprint.has(item.fingerprint));
  const foundButUndocumented = runtime.filter((item) => !documentedByFingerprint.has(item.fingerprint));
  const changedTypeOrLabel = runtime
    .map((runtimeItem) => {
      const documentedItem = documentedByFingerprint.get(runtimeItem.fingerprint);
      if (!documentedItem) {
        return null;
      }
      if (documentedItem.label === runtimeItem.label && documentedItem.role === runtimeItem.role) {
        return null;
      }
      return { documented: documentedItem, runtime: runtimeItem };
    })
    .filter((entry): entry is { documented: InventoryItem; runtime: InventoryItem } => entry !== null);

  return {
    documentedButNotFound,
    foundButUndocumented,
    changedTypeOrLabel,
    duplicates: [...duplicateItems(documented), ...duplicateItems(runtime)],
  };
}

export function reconciliationMarkdown(reconciliation: InventoryReconciliation): string {
  const lines = ["# CTA Inventory Reconciliation", ""];
  const section = (title: string, items: readonly string[]) => {
    lines.push(`## ${title}`, "");
    if (items.length === 0) {
      lines.push("- None", "");
      return;
    }
    lines.push(...items.map((item) => `- ${item}`), "");
  };
  section(
    "Documented But Not Found",
    reconciliation.documentedButNotFound.map((item) => `${item.route}: ${item.fingerprint}`),
  );
  section(
    "Found But Undocumented",
    reconciliation.foundButUndocumented.map((item) => `${item.route}: ${item.fingerprint}`),
  );
  section(
    "Changed Type Or Label",
    reconciliation.changedTypeOrLabel.map(
      ({ documented, runtime }) =>
        `${runtime.route}: ${runtime.fingerprint} documented=${documented.role ?? "unknown"}/${documented.label ?? ""} runtime=${runtime.role ?? "unknown"}/${runtime.label ?? ""}`,
    ),
  );
  section(
    "Duplicate Fingerprints",
    reconciliation.duplicates.map((item) => `${item.route}: ${item.fingerprint}`),
  );
  return lines.join("\n");
}
