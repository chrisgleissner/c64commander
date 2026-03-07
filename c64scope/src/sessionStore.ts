import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createRunId, errorResult, okResult, type FailureClass, type RunOutcome, type ScopeResult } from "./types.js";

const captureStateSchema = z.object({
  endpoints: z.array(z.string()),
  reservedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  status: z.enum(["idle", "reserved", "capturing", "stopped"]),
});

const stepSchema = z.object({
  stepId: z.string(),
  route: z.string(),
  featureArea: z.string(),
  action: z.string(),
  peerServer: z.string().nullable(),
  preconditions: z.array(z.string()),
  primaryOracle: z.string(),
  fallbackOracle: z.string().nullable(),
  recordedAt: z.string(),
  notes: z.string().nullable(),
});

const evidenceSchema = z.object({
  evidenceId: z.string(),
  stepId: z.string().nullable(),
  evidenceType: z.string(),
  summary: z.string(),
  path: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  attachedAt: z.string(),
});

const assertionSchema = z.object({
  assertionId: z.string(),
  title: z.string(),
  oracleClass: z.string(),
  passed: z.boolean(),
  details: z.record(z.string(), z.unknown()),
  recordedAt: z.string(),
});

const sessionSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  artifactDir: z.string(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  outcome: z.enum(["pass", "fail", "inconclusive"]).nullable(),
  failureClass: z.enum(["product_failure", "infrastructure_failure", "inconclusive"]).nullable(),
  reservedCaptureEndpoints: z.array(z.string()),
  capture: captureStateSchema,
  timeline: z.array(stepSchema),
  evidence: z.array(evidenceSchema),
  assertions: z.array(assertionSchema),
  summary: z.string().nullable(),
});

export type ScopeSession = z.infer<typeof sessionSchema>;

interface StartSessionInput {
  caseId: string;
  artifactDir?: string;
  captureEndpoints?: string[];
}

interface RecordStepInput {
  runId: string;
  stepId: string;
  route: string;
  featureArea: string;
  action: string;
  peerServer?: string;
  preconditions?: string[];
  primaryOracle: string;
  fallbackOracle?: string;
  notes?: string;
}

interface AttachEvidenceInput {
  runId: string;
  evidenceId: string;
  stepId?: string;
  evidenceType: string;
  summary: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

interface ReserveCaptureInput {
  runId: string;
  endpoints?: string[];
}

interface RecordAssertionInput {
  runId: string;
  assertionId: string;
  title: string;
  oracleClass: string;
  passed: boolean;
  details?: Record<string, unknown>;
}

interface FinalizeSessionInput {
  runId: string;
  outcome: RunOutcome;
  failureClass: FailureClass;
  summary: string;
}

export class ScopeSessionStore {
  private readonly sessions = new Map<string, ScopeSession>();

  constructor(private readonly artifactRoot: string) {}

  async startSession(input: StartSessionInput): Promise<ScopeResult> {
    const runId = createRunId();
    const artifactDir = input.artifactDir ?? path.join(this.artifactRoot, runId);
    const session: ScopeSession = {
      runId,
      caseId: input.caseId,
      artifactDir,
      createdAt: new Date().toISOString(),
      closedAt: null,
      outcome: null,
      failureClass: null,
      reservedCaptureEndpoints: input.captureEndpoints ?? [],
      capture: {
        endpoints: input.captureEndpoints ?? [],
        reservedAt: null,
        startedAt: null,
        stoppedAt: null,
        status: "idle",
      },
      timeline: [],
      evidence: [],
      assertions: [],
      summary: null,
    };

    sessionSchema.parse(session);
    this.sessions.set(runId, session);
    await this.persistSession(session);

    return okResult(runId, {
      caseId: session.caseId,
      artifactDir: session.artifactDir,
      reservedCaptureEndpoints: session.reservedCaptureEndpoints,
    });
  }

  async recordStep(input: RecordStepInput): Promise<ScopeResult> {
    const session = await this.requireOpenSession(input.runId);
    if (!session.ok) {
      return session;
    }

    const step = stepSchema.parse({
      stepId: input.stepId,
      route: input.route,
      featureArea: input.featureArea,
      action: input.action,
      peerServer: input.peerServer ?? null,
      preconditions: input.preconditions ?? [],
      primaryOracle: input.primaryOracle,
      fallbackOracle: input.fallbackOracle ?? null,
      recordedAt: new Date().toISOString(),
      notes: input.notes ?? null,
    });

    session.data.session.timeline.push(step);
    await this.persistSession(session.data.session);

    return okResult(input.runId, {
      stepId: step.stepId,
      timelineLength: session.data.session.timeline.length,
    });
  }

  async attachEvidence(input: AttachEvidenceInput): Promise<ScopeResult> {
    const session = await this.requireOpenSession(input.runId);
    if (!session.ok) {
      return session;
    }

    const evidence = evidenceSchema.parse({
      evidenceId: input.evidenceId,
      stepId: input.stepId ?? null,
      evidenceType: input.evidenceType,
      summary: input.summary,
      path: input.path ?? null,
      metadata: input.metadata ?? {},
      attachedAt: new Date().toISOString(),
    });

    session.data.session.evidence.push(evidence);
    await this.persistSession(session.data.session);

    return okResult(input.runId, {
      evidenceId: evidence.evidenceId,
      evidenceCount: session.data.session.evidence.length,
    });
  }

  async reserveCapture(input: ReserveCaptureInput): Promise<ScopeResult> {
    const session = await this.requireOpenSession(input.runId);
    if (!session.ok) {
      return session;
    }

    const endpoints = input.endpoints ?? ["udp://239.0.0.64:11064"];
    session.data.session.reservedCaptureEndpoints = endpoints;
    session.data.session.capture = {
      endpoints,
      reservedAt: new Date().toISOString(),
      startedAt: null,
      stoppedAt: null,
      status: "reserved",
    };
    await this.persistSession(session.data.session);

    return okResult(input.runId, {
      endpoints,
      captureStatus: session.data.session.capture.status,
    });
  }

  async startCapture(runId: string): Promise<ScopeResult> {
    const session = await this.requireOpenSession(runId);
    if (!session.ok) {
      return session;
    }
    if (session.data.session.capture.status !== "reserved") {
      return errorResult(runId, "capture_unavailable", "Capture must be reserved before it can start.", {
        captureStatus: session.data.session.capture.status,
      });
    }

    session.data.session.capture.startedAt = new Date().toISOString();
    session.data.session.capture.status = "capturing";
    await this.persistSession(session.data.session);

    return okResult(runId, {
      captureStatus: session.data.session.capture.status,
      endpoints: session.data.session.capture.endpoints,
    });
  }

  async stopCapture(runId: string): Promise<ScopeResult> {
    const session = await this.requireOpenSession(runId);
    if (!session.ok) {
      return session;
    }
    if (session.data.session.capture.status !== "capturing") {
      return errorResult(runId, "capture_unavailable", "Capture is not currently active.", {
        captureStatus: session.data.session.capture.status,
      });
    }

    session.data.session.capture.stoppedAt = new Date().toISOString();
    session.data.session.capture.status = "stopped";
    await this.persistSession(session.data.session);

    return okResult(runId, {
      captureStatus: session.data.session.capture.status,
      endpoints: session.data.session.capture.endpoints,
    });
  }

  async degradeCapture(runId: string, reason: string): Promise<ScopeResult> {
    const session = await this.requireOpenSession(runId);
    if (!session.ok) {
      return session;
    }
    const status = session.data.session.capture.status;
    if (status !== "reserved" && status !== "capturing") {
      return errorResult(runId, "capture_unavailable", "Capture must be reserved or active to degrade.", {
        captureStatus: status,
      });
    }

    session.data.session.capture.stoppedAt = new Date().toISOString();
    session.data.session.capture.status = "stopped";
    await this.persistSession(session.data.session);

    return errorResult(runId, "capture_degraded", reason, {
      captureStatus: "stopped",
      endpoints: session.data.session.capture.endpoints,
    });
  }

  async recordAssertion(input: RecordAssertionInput): Promise<ScopeResult> {
    const session = await this.requireOpenSession(input.runId);
    if (!session.ok) {
      return session;
    }

    const assertion = assertionSchema.parse({
      assertionId: input.assertionId,
      title: input.title,
      oracleClass: input.oracleClass,
      passed: input.passed,
      details: input.details ?? {},
      recordedAt: new Date().toISOString(),
    });

    session.data.session.assertions.push(assertion);
    await this.persistSession(session.data.session);

    return okResult(input.runId, {
      assertionId: assertion.assertionId,
      assertionCount: session.data.session.assertions.length,
    });
  }

  async finalizeSession(input: FinalizeSessionInput): Promise<ScopeResult> {
    const session = await this.requireOpenSession(input.runId);
    if (!session.ok) {
      return session;
    }

    session.data.session.closedAt = new Date().toISOString();
    session.data.session.outcome = input.outcome;
    session.data.session.failureClass = input.failureClass;
    session.data.session.summary = input.summary;
    await this.persistSession(session.data.session);
    await writeFile(
      path.join(session.data.session.artifactDir, "summary.md"),
      this.renderSummary(session.data.session),
      "utf8",
    );

    return okResult(input.runId, {
      outcome: input.outcome,
      failureClass: input.failureClass,
      artifactDir: session.data.session.artifactDir,
    });
  }

  async getArtifactSummary(runId: string): Promise<ScopeResult> {
    const session = this.sessions.get(runId);
    if (!session) {
      return errorResult(runId, "session_not_found", "Unknown run ID.", {});
    }

    return okResult(runId, {
      caseId: session.caseId,
      artifactDir: session.artifactDir,
      timelineLength: session.timeline.length,
      evidenceCount: session.evidence.length,
      assertionCount: session.assertions.length,
      outcome: session.outcome,
      failureClass: session.failureClass,
      summary: session.summary,
    });
  }

  private async requireOpenSession(runId: string): Promise<ScopeResult<{ session: ScopeSession }>> {
    const session = this.sessions.get(runId);
    if (!session) {
      return errorResult(runId, "session_not_found", "Unknown run ID.", {});
    }
    if (session.closedAt) {
      return errorResult(runId, "session_already_closed", "The session is already finalized.", {
        closedAt: session.closedAt,
      });
    }

    return okResult(runId, { session });
  }

  private async persistSession(session: ScopeSession): Promise<void> {
    await mkdir(session.artifactDir, { recursive: true });
    await writeFile(
      path.join(session.artifactDir, "session.json"),
      JSON.stringify(sessionSchema.parse(session), null, 2),
      "utf8",
    );
  }

  private renderSummary(session: ScopeSession): string {
    return [
      `# c64scope Session ${session.runId}`,
      "",
      `- Case ID: ${session.caseId}`,
      `- Outcome: ${session.outcome ?? "open"}`,
      `- Failure class: ${session.failureClass ?? "unclassified"}`,
      `- Timeline steps: ${session.timeline.length}`,
      `- Evidence items: ${session.evidence.length}`,
      `- Assertions: ${session.assertions.length}`,
      "",
      "## Summary",
      "",
      session.summary ?? "No summary recorded.",
    ].join("\n");
  }
}
