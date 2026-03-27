/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { assertionCatalog, caseCatalog, failureTaxonomy } from "./catalog/index.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  readText: () => string;
}

export const resources: ResourceDefinition[] = [
  {
    uri: "c64scope://catalog/cases",
    name: "Case Catalog",
    description: "Initial ready-case catalog for the agentic rollout.",
    mimeType: "application/json",
    readText: () => JSON.stringify(caseCatalog, null, 2),
  },
  {
    uri: "c64scope://catalog/assertions",
    name: "Assertion Catalog",
    description: "Built-in assertion definitions and oracle classes.",
    mimeType: "application/json",
    readText: () => JSON.stringify(assertionCatalog, null, 2),
  },
  {
    uri: "c64scope://catalog/playbooks",
    name: "Playbook References",
    description: "Pointers to the authoritative repository playbooks and safety documents.",
    mimeType: "text/markdown",
    readText: () =>
      [
        "# Playbook References",
        "",
        "- docs/testing/agentic-tests/agentic-action-model.md",
        "- docs/testing/agentic-tests/agentic-oracle-catalog.md",
        "- docs/testing/agentic-tests/agentic-safety-policy.md",
        "- docs/testing/agentic-tests/agentic-android-runtime-contract.md",
        "- docs/testing/agentic-tests/agentic-observability-model.md",
      ].join("\n"),
  },
  {
    uri: "c64scope://schema/artifact-bundle",
    name: "Artifact Bundle Schema",
    description: "Human-readable summary of the artifact bundle structure.",
    mimeType: "text/markdown",
    readText: () =>
      [
        "# Artifact Bundle Schema",
        "",
        "- session.json",
        "- summary.md",
        "- recording.mp4 when capture is implemented and enabled",
        "- external evidence references attached to the session timeline",
      ].join("\n"),
  },
  {
    uri: "c64scope://catalog/failure-taxonomy",
    name: "Failure Taxonomy",
    description: "Run-classification guidance for product, infrastructure, and inconclusive outcomes.",
    mimeType: "application/json",
    readText: () => JSON.stringify(failureTaxonomy, null, 2),
  },
];

export function listResources() {
  return resources.map(({ uri, name, description, mimeType }) => ({
    uri,
    name,
    description,
    mimeType,
  }));
}

export function readResource(uri: string) {
  return resources.find((resource) => resource.uri === uri);
}
