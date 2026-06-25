/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CtaStateNode {
  route: string;
  overlay?: string | null;
  target: "c64u" | "u64" | "unknown";
  connectionState: string;
  featureFlags?: readonly string[];
  pageMode?: string | null;
  playbackState?: string | null;
  mountedDriveState?: string | null;
  orientation?: "portrait" | "landscape" | "unknown";
  displayProfile?: string | null;
  theme?: string | null;
}

export interface CtaStateEdge {
  from: string;
  to: string;
  actionId: string;
  priority: number;
}

export interface SerializedCtaStateGraph {
  nodes: CtaStateNode[];
  edges: CtaStateEdge[];
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort((left, right) => left.localeCompare(right));
}

export function stateKey(node: CtaStateNode): string {
  return JSON.stringify({
    route: node.route,
    overlay: node.overlay ?? null,
    target: node.target,
    connectionState: node.connectionState,
    featureFlags: normalizeList(node.featureFlags),
    pageMode: node.pageMode ?? null,
    playbackState: node.playbackState ?? null,
    mountedDriveState: node.mountedDriveState ?? null,
    orientation: node.orientation ?? "unknown",
    displayProfile: node.displayProfile ?? null,
    theme: node.theme ?? null,
  });
}

export class CtaStateGraph {
  private readonly nodes = new Map<string, CtaStateNode>();
  private readonly edges = new Map<string, CtaStateEdge[]>();

  addNode(node: CtaStateNode): string {
    const key = stateKey(node);
    if (!this.nodes.has(key)) {
      this.nodes.set(key, node);
    }
    return key;
  }

  addEdge(from: CtaStateNode, to: CtaStateNode, actionId: string, priority = 0): CtaStateEdge {
    const fromKey = this.addNode(from);
    const toKey = this.addNode(to);
    const edge = { from: fromKey, to: toKey, actionId, priority };
    const existing = this.edges.get(fromKey) ?? [];
    if (!existing.some((entry) => entry.to === toKey && entry.actionId === actionId)) {
      existing.push(edge);
      existing.sort((left, right) => left.priority - right.priority || left.actionId.localeCompare(right.actionId));
      this.edges.set(fromKey, existing);
    }
    return edge;
  }

  nextEdges(from: CtaStateNode, visitedStateKeys: ReadonlySet<string>): CtaStateEdge[] {
    const fromKey = stateKey(from);
    return (this.edges.get(fromKey) ?? []).filter((edge) => !visitedStateKeys.has(edge.to));
  }

  serialize(): SerializedCtaStateGraph {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()].flat(),
    };
  }
}
