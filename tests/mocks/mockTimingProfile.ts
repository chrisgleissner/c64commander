import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MockTimingFaultMode = "none" | "timeout" | "refused" | "auth" | "slow";

export type MockTimingClass = {
    baseDelayMs: number;
    jitterRangeMs: number;
    jitterSeed: number;
};

export type MockTimingRule = {
    methods: string[];
    pathType: "exact" | "prefix" | "regex";
    path: string;
    timingClass: string;
};

export type MockTimingProfile = {
    version: number;
    seed: number;
    defaultClassId: string;
    faults: {
        slowExtraDelayMs: number;
        slowJitterRangeMs: number;
        timeoutMinimumDelayMs: number;
    };
    classes: Record<string, MockTimingClass>;
    rules: MockTimingRule[];
};

const profilePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../android/app/src/main/assets/mock-timing-profile.json",
);

let cachedProfile: MockTimingProfile | null = null;

const normalizeMethod = (method: string) => method.trim().toUpperCase();

export const loadMockTimingProfile = async (): Promise<MockTimingProfile> => {
    if (cachedProfile) return cachedProfile;
    const raw = await readFile(profilePath, "utf8");
    cachedProfile = JSON.parse(raw) as MockTimingProfile;
    return cachedProfile;
};

export const resolveMockTimingClassId = (profile: MockTimingProfile, method: string, pathname: string) => {
    const normalizedMethod = normalizeMethod(method);
    const matchedRule = profile.rules.find((rule) => {
        const methods = rule.methods.map(normalizeMethod);
        const methodMatches = methods.includes(normalizedMethod);
        if (!methodMatches) return false;
        if (rule.pathType === "exact") {
            return pathname === rule.path;
        }
        if (rule.pathType === "prefix") {
            return pathname.startsWith(rule.path);
        }
        return new RegExp(rule.path).test(pathname);
    });
    return matchedRule?.timingClass ?? profile.defaultClassId;
};

const resolveDeterministicJitterMs = (
    profile: MockTimingProfile,
    timingClass: MockTimingClass,
    requestSequence: number,
) => {
    const range = Math.max(0, Math.round(timingClass.jitterRangeMs));
    if (range === 0) return 0;
    const seed = profile.seed + timingClass.jitterSeed * 13 + requestSequence * 17;
    return Math.abs(seed % (range + 1));
};

export const resolveMockTimingDelayMs = (params: {
    profile: MockTimingProfile;
    method: string;
    pathname: string;
    requestSequence: number;
    faultMode: MockTimingFaultMode;
    latencyOverrideMs: number | null;
}) => {
    const { profile, method, pathname, requestSequence, faultMode, latencyOverrideMs } = params;
    const classId = resolveMockTimingClassId(profile, method, pathname);
    const timingClass = profile.classes[classId] ?? profile.classes[profile.defaultClassId];
    if (!timingClass) {
        throw new Error(`Mock timing class not found for ${classId}`);
    }
    const overrideDelayMs = latencyOverrideMs === null ? null : Math.max(0, Math.round(latencyOverrideMs));
    if (faultMode === "timeout") {
        return Math.max(profile.faults.timeoutMinimumDelayMs, overrideDelayMs ?? 0);
    }
    if (overrideDelayMs !== null) {
        return overrideDelayMs;
    }
    const baseDelayMs =
        faultMode === "slow" ? timingClass.baseDelayMs + profile.faults.slowExtraDelayMs : timingClass.baseDelayMs;
    const jitterRangeMs =
        faultMode === "slow" ? timingClass.jitterRangeMs + profile.faults.slowJitterRangeMs : timingClass.jitterRangeMs;
    return baseDelayMs + resolveDeterministicJitterMs(profile, { ...timingClass, jitterRangeMs }, requestSequence);
};
