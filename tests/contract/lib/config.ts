/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import yaml from "js-yaml";

const ModeSchema = z.union([z.literal("SAFE"), z.literal("STRESS")]);
const AuthSchema = z.union([z.literal("ON"), z.literal("OFF")]);
const FtpModeSchema = z.union([z.literal("PASV"), z.literal("PORT")]);
const MatrixTestTypeSchema = z.union([z.literal("soak"), z.literal("stress"), z.literal("spike")]);
const FtpSessionModeSchema = z.union([z.literal("shared"), z.literal("per-request")]);
const PrgActionSchema = z.union([z.literal("run"), z.literal("load")]);
const BreakpointScenarioIdSchema = z.literal("rest.breakpoint.sid-volume");

const StressBreakpointTargetSchema = z.object({
  category: z.string().min(1),
  item: z.string().min(1),
});

const StressBreakpointSchema = z
  .object({
    scenarioId: BreakpointScenarioIdSchema,
    rateRampMs: z.array(z.number().int().min(1)).min(1),
    concurrencyRamp: z.array(z.number().int().min(1)).min(1),
    stageDurationMs: z.number().int().min(100),
    failureDetectionTimeoutMs: z.number().int().min(100),
    tailRequestCount: z.number().int().min(1),
    targets: z.array(StressBreakpointTargetSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const knownTargets = loadKnownConfigTargets();
    for (const [index, target] of value.targets.entries()) {
      if (knownTargets.has(configTargetKey(target.category, target.item))) {
        continue;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targets", index],
        message: `Unknown config target: ${target.category} / ${target.item}`,
      });
    }
  });

const StressMatrixSoakSchema = z.object({
  testType: z.literal("soak"),
  operationId: z.string().min(1),
  concurrency: z.number().int().min(1),
  rateDelayMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  failureDetectionTimeoutMs: z.number().int().min(100),
  ftpSessionMode: FtpSessionModeSchema.default("shared").optional(),
});

const StressMatrixStressSchema = z.object({
  testType: z.literal("stress"),
  operationIds: z.array(z.string().min(1)).min(1),
  concurrencyLevels: z.array(z.number().int().min(1)).min(1),
  rateRampMs: z.array(z.number().int().min(0)).min(1),
  ftpSessionModes: z.array(FtpSessionModeSchema).min(1),
  stageDurationMs: z.number().int().min(100),
  failureDetectionTimeoutMs: z.number().int().min(100),
  tailRequestCount: z.number().int().min(1),
});

const StressMatrixSpikeSchema = z.object({
  testType: z.literal("spike"),
  operationIds: z.array(z.string().min(1)).min(1),
  spikeConcurrency: z.number().int().min(1),
  spikeRateDelayMs: z.number().int().min(0),
  spikeDurationMs: z.number().int().min(100),
  idleDurationMs: z.number().int().min(100),
  spikeCount: z.number().int().min(1),
  failureDetectionTimeoutMs: z.number().int().min(100),
  ftpSessionModes: z.array(FtpSessionModeSchema).min(1).default(["shared"]).optional(),
});

const TraceLevelSchema = z.union([z.literal("minimal"), z.literal("full")]);

const TraceSchema = z
  .object({
    enabled: z.boolean().default(false),
    level: TraceLevelSchema.default("full"),
  })
  .optional();

const StressMatrixSchema = z.discriminatedUnion("testType", [
  StressMatrixSoakSchema,
  StressMatrixStressSchema,
  StressMatrixSpikeSchema,
]);

export const ConfigSchema = z
  .object({
    baseUrl: z.string().url(),
    mode: ModeSchema,
    auth: AuthSchema,
    password: z.string().optional(),
    ftpMode: FtpModeSchema,
    ftpPort: z.number().int().min(1).max(65535).optional(),
    outputDir: z.string(),
    concurrency: z.object({
      restMaxInFlight: z.number().int().min(1),
      ftpMaxSessions: z.number().int().min(1),
      mixedMaxInFlight: z.number().int().min(1),
    }),
    pacing: z.object({
      restMinDelayMs: z.number().int().min(0),
      ftpMinDelayMs: z.number().int().min(0),
    }),
    health: z.object({
      endpoint: z.string(),
      intervalMs: z.number().int().min(100),
      timeoutMs: z.number().int().min(100),
    }),
    timeouts: z.object({
      restTimeoutMs: z.number().int().min(100),
      ftpTimeoutMs: z.number().int().min(100),
      scenarioTimeoutMs: z.number().int().min(1000),
      maxDestructiveScenarioMs: z.number().int().min(1000),
    }),
    scratch: z.object({
      ftpDir: z.string(),
    }),
    scenarios: z
      .object({
        rest: z.array(z.string()).optional(),
        ftp: z.array(z.string()).optional(),
        mixed: z.array(z.string()).optional(),
      })
      .optional(),
    media: z
      .object({
        diskImagePath: z.string().optional(),
        diskDrive: z.union([z.literal("a"), z.literal("b")]).optional(),
        diskType: z.string().optional(),
        diskMode: z.union([z.literal("readwrite"), z.literal("readonly"), z.literal("unlinked")]).optional(),
        sidFilePath: z.string().optional(),
        sidSongNr: z.number().int().min(0).optional(),
        prgFilePath: z.string().optional(),
        prgAction: PrgActionSchema.optional(),
        modFilePath: z.string().optional(),
        crtFilePath: z.string().optional(),
      })
      .optional(),
    allowMachineReset: z.boolean().optional(),
    http: z
      .object({
        keepAlive: z.boolean().optional(),
        maxSockets: z.number().int().min(1).optional(),
      })
      .optional(),
    trace: TraceSchema,
    stressBreakpoint: StressBreakpointSchema.optional(),
    stressMatrix: StressMatrixSchema.optional(),
  })
  .refine((value) => (value.auth === "ON" ? Boolean(value.password) : true), {
    message: "password is required when auth is ON",
    path: ["password"],
  })
  .refine((value) => (value.stressBreakpoint ? value.mode === "STRESS" : true), {
    message: "stressBreakpoint is only supported when mode is STRESS",
    path: ["stressBreakpoint"],
  })
  .refine((value) => (value.stressMatrix ? value.mode === "STRESS" : true), {
    message: "stressMatrix is only supported when mode is STRESS",
    path: ["stressMatrix"],
  })
  .refine((value) => !(value.stressBreakpoint && value.stressMatrix), {
    message: "stressBreakpoint and stressMatrix are mutually exclusive",
    path: ["stressMatrix"],
  });

export type HarnessConfig = z.infer<typeof ConfigSchema>;
export type StressBreakpointConfig = z.infer<typeof StressBreakpointSchema>;
export type StressBreakpointTarget = z.infer<typeof StressBreakpointTargetSchema>;
export type StressMatrixConfig = z.infer<typeof StressMatrixSchema>;
export type StressMatrixTestType = z.infer<typeof MatrixTestTypeSchema>;
export type FtpSessionMode = z.infer<typeof FtpSessionModeSchema>;

export const DefaultConfig: HarnessConfig = {
  baseUrl: "http://c64u",
  mode: "SAFE",
  auth: "OFF",
  password: "",
  ftpMode: "PASV",
  ftpPort: 21,
  outputDir: "test-results/contract",
  concurrency: {
    restMaxInFlight: 2,
    ftpMaxSessions: 1,
    mixedMaxInFlight: 2,
  },
  pacing: {
    restMinDelayMs: 100,
    ftpMinDelayMs: 100,
  },
  health: {
    endpoint: "/v1/version",
    intervalMs: 5000,
    timeoutMs: 2000,
  },
  timeouts: {
    restTimeoutMs: 8000,
    ftpTimeoutMs: 15000,
    scenarioTimeoutMs: 60000,
    maxDestructiveScenarioMs: 120000,
  },
  scratch: {
    ftpDir: "/Temp/contract-test",
  },
  media: {
    diskDrive: "a",
    prgAction: "run",
  },
  allowMachineReset: false,
  trace: {
    enabled: false,
    level: "full",
  },
};

export function loadConfig(configPath?: string): HarnessConfig {
  if (!configPath) {
    return DefaultConfig;
  }
  const absolutePath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const data = JSON.parse(raw);
  return ConfigSchema.parse({ ...DefaultConfig, ...data });
}

let knownConfigTargetsCache: Set<string> | null = null;

function loadKnownConfigTargets(): Set<string> {
  if (knownConfigTargetsCache) {
    return knownConfigTargetsCache;
  }

  const configCatalogPath = path.join(process.cwd(), "docs/c64/c64u-config.yaml");
  const raw = fs.readFileSync(configCatalogPath, "utf8");
  const doc = yaml.load(raw) as {
    config?: {
      categories?: Record<string, { items?: Record<string, unknown> }>;
    };
  };

  const targets = new Set<string>();
  const categories = doc.config?.categories ?? {};
  for (const [category, categoryEntry] of Object.entries(categories)) {
    const items = categoryEntry.items ?? {};
    for (const item of Object.keys(items)) {
      targets.add(configTargetKey(category, item));
    }
  }

  knownConfigTargetsCache = targets;
  return targets;
}

function configTargetKey(category: string, item: string): string {
  return `${category}::${item}`;
}
