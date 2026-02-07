import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const ModeSchema = z.union([z.literal("SAFE"), z.literal("STRESS")]);
const AuthSchema = z.union([z.literal("ON"), z.literal("OFF")]);
const FtpModeSchema = z.union([z.literal("PASV"), z.literal("PORT")]);
const PrgActionSchema = z.union([z.literal("run"), z.literal("load")]);

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
            mixedMaxInFlight: z.number().int().min(1)
        }),
        pacing: z.object({
            restMinDelayMs: z.number().int().min(0),
            ftpMinDelayMs: z.number().int().min(0)
        }),
        health: z.object({
            endpoint: z.string(),
            intervalMs: z.number().int().min(100),
            timeoutMs: z.number().int().min(100)
        }),
        timeouts: z.object({
            restTimeoutMs: z.number().int().min(100),
            ftpTimeoutMs: z.number().int().min(100),
            scenarioTimeoutMs: z.number().int().min(1000),
            maxDestructiveScenarioMs: z.number().int().min(1000)
        }),
        scratch: z.object({
            ftpDir: z.string()
        }),
        scenarios: z
            .object({
                rest: z.array(z.string()).optional(),
                ftp: z.array(z.string()).optional(),
                mixed: z.array(z.string()).optional()
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
                crtFilePath: z.string().optional()
            })
            .optional(),
        allowMachineReset: z.boolean().optional(),
        http: z
            .object({
                keepAlive: z.boolean().optional(),
                maxSockets: z.number().int().min(1).optional()
            })
            .optional()
    })
    .refine((value) => (value.auth === "ON" ? Boolean(value.password) : true), {
        message: "password is required when auth is ON",
        path: ["password"]
    });

export type HarnessConfig = z.infer<typeof ConfigSchema>;

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
        mixedMaxInFlight: 2
    },
    pacing: {
        restMinDelayMs: 100,
        ftpMinDelayMs: 100
    },
    health: {
        endpoint: "/v1/version",
        intervalMs: 5000,
        timeoutMs: 2000
    },
    timeouts: {
        restTimeoutMs: 8000,
        ftpTimeoutMs: 15000,
        scenarioTimeoutMs: 60000,
        maxDestructiveScenarioMs: 120000
    },
    scratch: {
        ftpDir: "/Temp/contract-test"
    },
    media: {
        diskDrive: "a",
        prgAction: "run"
    },
    allowMachineReset: false
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
