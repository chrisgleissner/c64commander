/**
 * Golden Action Fixture Tests
 *
 * These tests convert trace events to action summaries and compare against
 * golden action fixtures for regression detection.
 *
 * To update golden fixtures when conversion logic changes intentionally:
 *   UPDATE_GOLDENS=1 npm run test -- tests/unit/diagnostics/actionSummariesGolden.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildActionSummaries, type ActionSummary, type ActionSummaryEffect } from '@/lib/diagnostics/actionSummaries';
import type { TraceEvent } from '@/lib/tracing/types';

const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === '1';

// Use process.cwd() for workspace-relative paths since __dirname varies with test runner
const WORKSPACE_ROOT = process.cwd();
const FIXTURES_ROOT = path.join(WORKSPACE_ROOT, 'tests/fixtures/action-summaries');
const ORGANIC_ROOT = path.join(FIXTURES_ROOT, 'organic');
const SYNTHETIC_ROOT = path.join(FIXTURES_ROOT, 'synthetic');

const ORGANIC_TRACE_PATH = path.join(
  ORGANIC_ROOT,
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote',
  'android-phone',
  'trace.json',
);
const ORGANIC_ACTIONS_PATH = path.join(
  ORGANIC_ROOT,
  'playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote',
  'android-phone',
  'actions.json',
);

const SYNTHETIC_TRACE_PATH = path.join(SYNTHETIC_ROOT, 'comprehensive', 'trace.json');
const SYNTHETIC_ACTIONS_PATH = path.join(SYNTHETIC_ROOT, 'comprehensive', 'actions.json');

/**
 * Normalize action summaries for deterministic comparison.
 * Removes volatile/non-semantic fields per tracing spec.
 */
type NormalizedActionSummary = {
  correlationId: string;
  actionName: string;
  origin: string;
  originalOrigin?: string;
  durationMs: number | null;
  durationMsMissing?: true;
  outcome: string;
  errorMessage?: string;
  restCount?: number;
  ftpCount?: number;
  errorCount?: number;
  effects?: NormalizedEffect[];
};

type NormalizedEffect =
  | {
      type: 'REST';
      method: string;
      path: string;
      target: string | null;
      status: number | string | null;
      error?: string;
    }
  | {
      type: 'FTP';
      operation: string;
      path: string;
      target: string | null;
      result: string | null;
      error?: string;
    };

const normalizeEffect = (effect: ActionSummaryEffect): NormalizedEffect => {
  if (effect.type === 'REST') {
    return {
      type: 'REST',
      method: effect.method,
      path: effect.path,
      target: effect.target,
      status: effect.status,
      ...(effect.error !== undefined ? { error: effect.error } : {}),
    };
  }
  return {
    type: 'FTP',
    operation: effect.operation,
    path: effect.path,
    target: effect.target,
    result: effect.result,
    ...(effect.error !== undefined ? { error: effect.error } : {}),
  };
};

const normalizeActionSummaries = (summaries: ActionSummary[]): NormalizedActionSummary[] => {
  return summaries.map((s) => ({
    correlationId: s.correlationId,
    actionName: s.actionName,
    origin: s.origin,
    ...(s.originalOrigin !== undefined ? { originalOrigin: s.originalOrigin } : {}),
    durationMs: s.durationMs,
    ...(s.durationMsMissing ? { durationMsMissing: true } : {}),
    outcome: s.outcome,
    ...(s.errorMessage !== undefined ? { errorMessage: s.errorMessage } : {}),
    ...(s.restCount !== undefined ? { restCount: s.restCount } : {}),
    ...(s.ftpCount !== undefined ? { ftpCount: s.ftpCount } : {}),
    ...(s.errorCount !== undefined ? { errorCount: s.errorCount } : {}),
    ...(s.effects !== undefined ? { effects: s.effects.map(normalizeEffect) } : {}),
  }));
};

const loadTraceEvents = (tracePath: string): TraceEvent[] => {
  const content = fs.readFileSync(tracePath, 'utf-8');
  return JSON.parse(content) as TraceEvent[];
};

const loadGoldenActions = (actionsPath: string): NormalizedActionSummary[] | null => {
  if (!fs.existsSync(actionsPath)) return null;
  const content = fs.readFileSync(actionsPath, 'utf-8');
  return JSON.parse(content) as NormalizedActionSummary[];
};

const writeGoldenActions = (actionsPath: string, actions: NormalizedActionSummary[]) => {
  const dir = path.dirname(actionsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(actionsPath, JSON.stringify(actions, null, 2) + '\n');
};

describe('Golden Action Fixture Tests', () => {
  describe('Organic trace (Playwright golden)', () => {
    it('converts end-to-end playback trace to action summaries matching golden fixture', () => {
      const traceEvents = loadTraceEvents(ORGANIC_TRACE_PATH);
      const summaries = buildActionSummaries(traceEvents);
      const normalized = normalizeActionSummaries(summaries);

      if (UPDATE_GOLDENS) {
        writeGoldenActions(ORGANIC_ACTIONS_PATH, normalized);
        console.log(`Updated golden fixture: ${ORGANIC_ACTIONS_PATH}`);
      }

      const golden = loadGoldenActions(ORGANIC_ACTIONS_PATH);
      expect(golden).not.toBeNull();
      expect(normalized).toEqual(golden);
    });

    it('contains expected diversity in the organic trace', () => {
      const traceEvents = loadTraceEvents(ORGANIC_TRACE_PATH);
      const summaries = buildActionSummaries(traceEvents);

      // Verify the trace has the expected complexity
      expect(summaries.length).toBeGreaterThan(5);

      const hasUser = summaries.some((s) => s.origin === 'user');
      const hasSystem = summaries.some((s) => s.origin === 'system');
      const hasRestEffects = summaries.some((s) => s.restCount > 0);
      const hasFtpEffects = summaries.some((s) => s.ftpCount > 0);
      const hasErrors = summaries.some((s) => s.errorCount > 0);

      expect(hasUser).toBe(true);
      expect(hasSystem).toBe(true);
      expect(hasRestEffects).toBe(true);
      expect(hasFtpEffects).toBe(true);
      expect(hasErrors).toBe(true);
    });
  });

  describe('Synthetic trace (comprehensive coverage)', () => {
    it('converts synthetic trace to action summaries matching golden fixture', () => {
      const traceEvents = loadTraceEvents(SYNTHETIC_TRACE_PATH);
      const summaries = buildActionSummaries(traceEvents);
      const normalized = normalizeActionSummaries(summaries);

      if (UPDATE_GOLDENS) {
        writeGoldenActions(SYNTHETIC_ACTIONS_PATH, normalized);
        console.log(`Updated golden fixture: ${SYNTHETIC_ACTIONS_PATH}`);
      }

      const golden = loadGoldenActions(SYNTHETIC_ACTIONS_PATH);
      expect(golden).not.toBeNull();
      expect(normalized).toEqual(golden);
    });

    it('covers all required derivation paths', () => {
      const traceEvents = loadTraceEvents(SYNTHETIC_TRACE_PATH);
      const summaries = buildActionSummaries(traceEvents);

      // COR-0000: user, REST + FTP, success
      const cor0 = summaries.find((s) => s.correlationId === 'COR-0000');
      expect(cor0).toBeDefined();
      expect(cor0?.origin).toBe('user');
      expect(cor0?.originalOrigin).toBeUndefined();
      expect(cor0?.restCount).toBe(1);
      expect(cor0?.ftpCount).toBe(1);
      expect(cor0?.outcome).toBe('success');
      expect(cor0?.errorCount).toBeUndefined();

      // COR-0001: system (automatic), REST only, success
      const cor1 = summaries.find((s) => s.correlationId === 'COR-0001');
      expect(cor1).toBeDefined();
      expect(cor1?.origin).toBe('system');
      expect(cor1?.originalOrigin).toBe('automatic');
      expect(cor1?.restCount).toBe(1);
      expect(cor1?.ftpCount).toBeUndefined();
      expect(cor1?.outcome).toBe('success');

      // COR-0002: user, REST error, error outcome with error count
      const cor2 = summaries.find((s) => s.correlationId === 'COR-0002');
      expect(cor2).toBeDefined();
      expect(cor2?.origin).toBe('user');
      expect(cor2?.originalOrigin).toBeUndefined();
      expect(cor2?.outcome).toBe('error');
      expect(cor2?.errorCount).toBe(1);
      expect(cor2?.errorMessage).toContain('mount');

      // COR-0003: system (system), FTP error, error outcome
      const cor3 = summaries.find((s) => s.correlationId === 'COR-0003');
      expect(cor3).toBeDefined();
      expect(cor3?.origin).toBe('system');
      expect(cor3?.originalOrigin).toBeUndefined();
      expect(cor3?.ftpCount).toBe(1);
      expect(cor3?.outcome).toBe('error');
      expect(cor3?.errorCount).toBe(1);

      // COR-0004: user, timeout outcome
      const cor4 = summaries.find((s) => s.correlationId === 'COR-0004');
      expect(cor4).toBeDefined();
      expect(cor4?.outcome).toBe('timeout');

      // COR-0005: system (automatic), incomplete (no action-end)
      const cor5 = summaries.find((s) => s.correlationId === 'COR-0005');
      expect(cor5).toBeDefined();
      expect(cor5?.origin).toBe('system');
      expect(cor5?.outcome).toBe('incomplete');
      expect(cor5?.restCount).toBe(1);
    });

    it('correctly derives effect details', () => {
      const traceEvents = loadTraceEvents(SYNTHETIC_TRACE_PATH);
      const summaries = buildActionSummaries(traceEvents);

      // Check REST effect details from COR-0000
      const cor0 = summaries.find((s) => s.correlationId === 'COR-0000');
      const cor0Effects = cor0?.effects ?? [];
      const restEffect = cor0Effects.find((e) => e.type === 'REST');
      expect(restEffect).toBeDefined();
      if (restEffect && restEffect.type === 'REST') {
        expect(restEffect.method).toBe('POST');
        expect(restEffect.path).toBe('/v1/runners/sidplay');
        expect(restEffect.target).toBe('real-device');
        expect(restEffect.status).toBe(200);
      }

      // Check FTP effect details from COR-0000
      const ftpEffect = cor0Effects.find((e) => e.type === 'FTP');
      expect(ftpEffect).toBeDefined();
      if (ftpEffect && ftpEffect.type === 'FTP') {
        expect(ftpEffect.operation).toBe('upload');
        expect(ftpEffect.path).toBe('/Usb0/Music/test.sid');
        expect(ftpEffect.target).toBe('real-device');
        expect(ftpEffect.result).toBe('success');
      }

      // Check error effect from COR-0003
      const cor3 = summaries.find((s) => s.correlationId === 'COR-0003');
      const cor3Effects = cor3?.effects ?? [];
      const ftpErrorEffect = cor3Effects.find((e) => e.type === 'FTP');
      expect(ftpErrorEffect).toBeDefined();
      if (ftpErrorEffect && ftpErrorEffect.type === 'FTP') {
        expect(ftpErrorEffect.result).toBe('failure');
        expect(ftpErrorEffect.error).toBe('Permission denied');
      }
    });
  });

  describe('Determinism', () => {
    it('produces identical output for the same input (organic)', () => {
      const traceEvents = loadTraceEvents(ORGANIC_TRACE_PATH);
      const summaries1 = normalizeActionSummaries(buildActionSummaries(traceEvents));
      const summaries2 = normalizeActionSummaries(buildActionSummaries(traceEvents));
      expect(summaries1).toEqual(summaries2);
    });

    it('produces identical output for the same input (synthetic)', () => {
      const traceEvents = loadTraceEvents(SYNTHETIC_TRACE_PATH);
      const summaries1 = normalizeActionSummaries(buildActionSummaries(traceEvents));
      const summaries2 = normalizeActionSummaries(buildActionSummaries(traceEvents));
      expect(summaries1).toEqual(summaries2);
    });
  });
});
