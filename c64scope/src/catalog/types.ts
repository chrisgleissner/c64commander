/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CaseDefinition {
  id: string;
  title: string;
  featureArea: string;
  route: string;
  safetyClass: "read-only" | "guarded-mutation" | "destructive";
  primaryOracle: string;
  fallbackOracle: string;
  cleanup: string;
  docRefs: string[];
  dependencies: string[];
  testability: "ready" | "guarded" | "partial" | "blocked";
  blockerRef?: string;
}

export interface AssertionDefinition {
  id: string;
  title: string;
  oracleClass: string;
  description: string;
}

export interface EvidenceTypeDefinition {
  type: string;
  description: string;
  oracleClass: string;
  requiredMetadata: string[];
}

/**
 * Test-owned namespaces for agentic test isolation.
 * All destructive operations must target only these namespaces.
 */
export const testNamespaces = {
  /** Android app-local staging directory for test fixtures */
  androidStaging: "/sdcard/Download/c64commander-agentic-test/",
  /** C64U FTP path prefix for test-owned disk images */
  c64uDiskPrefix: "/USB0/agentic-test/",
  /** App config snapshot name prefix */
  configSnapshotPrefix: "agentic-test-",
  /** Disk library entry name prefix */
  diskLibraryPrefix: "agentic-test-",
  /** Settings export filename prefix */
  settingsExportPrefix: "agentic-test-settings-",
  /** RAM dump filename prefix */
  ramDumpPrefix: "agentic-test-ram-",
  /** c64scope artifact output directory */
  artifactDir: "artifacts/",
} as const;
