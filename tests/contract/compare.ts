import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.left || !args.right) {
    throw new Error("Usage: compare --left <runDirA> --right <runDirB> [--out <dir>]");
}

const left = loadRun(args.left);
const right = loadRun(args.right);

const latencyDelta = compareLatency(left.latency, right.latency);
const cooldownDelta = compareCooldowns(left.cooldowns, right.cooldowns);
const concurrencyDelta = compareConcurrency(left.concurrency, right.concurrency);

const summary = renderSummary(latencyDelta, cooldownDelta, concurrencyDelta, args.left, args.right);

const outDir = args.out || process.cwd();
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, "comparison.json"), JSON.stringify({ latencyDelta, cooldownDelta, concurrencyDelta }, null, 2));
fs.writeFileSync(path.join(outDir, "comparison.md"), `${summary}\n`);

console.log(summary);

function loadRun(dir: string) {
    return {
        latency: readJson(path.join(dir, "latency-stats.json")),
        cooldowns: {
            rest: readJson(path.join(dir, "rest-cooldowns.json")),
            ftp: readJson(path.join(dir, "ftp-cooldowns.json"))
        },
        concurrency: readJson(path.join(dir, "concurrency.json"))
    };
}

function compareLatency(left: any, right: any) {
    const index = new Map<string, any>();
    for (const op of left.operations || []) {
        index.set(op.id, op);
    }

    const deltas = [] as Array<{ id: string; p95Delta: number; p99Delta: number }>;
    for (const op of right.operations || []) {
        const l = index.get(op.id);
        if (!l) continue;
        deltas.push({
            id: op.id,
            p95Delta: (op.p95 || 0) - (l.p95 || 0),
            p99Delta: (op.p99 || 0) - (l.p99 || 0)
        });
    }
    return deltas;
}

function compareCooldowns(left: { rest: any; ftp: any }, right: { rest: any; ftp: any }) {
    return {
        rest: diffCooldownSet(left.rest, right.rest),
        ftp: diffCooldownSet(left.ftp, right.ftp)
    };
}

function diffCooldownSet(left: any, right: any) {
    const index = new Map<string, any>();
    for (const op of left.operations || []) {
        index.set(op.id, op);
    }
    const deltas = [] as Array<{ id: string; recommendedDelta: number }>;
    for (const op of right.operations || []) {
        const l = index.get(op.id);
        if (!l) continue;
        deltas.push({
            id: op.id,
            recommendedDelta: (op.recommendedDelayMs || 0) - (l.recommendedDelayMs || 0)
        });
    }
    return deltas;
}

function compareConcurrency(left: any, right: any) {
    const leftLimits = left.limits || {};
    const rightLimits = right.limits || {};
    return {
        restMaxInFlight: (rightLimits.restMaxInFlight || 0) - (leftLimits.restMaxInFlight || 0),
        ftpMaxSessions: (rightLimits.ftpMaxSessions || 0) - (leftLimits.ftpMaxSessions || 0),
        mixedMaxInFlight: (rightLimits.mixedMaxInFlight || 0) - (leftLimits.mixedMaxInFlight || 0)
    };
}

function renderSummary(latency: any[], cooldowns: any, concurrency: any, leftDir: string, rightDir: string): string {
    const latencyUp = latency.filter((d) => d.p95Delta > 0).length;
    const latencyDown = latency.filter((d) => d.p95Delta < 0).length;
    const restCooldownUp = cooldowns.rest.filter((d: any) => d.recommendedDelta > 0).length;
    const ftpCooldownUp = cooldowns.ftp.filter((d: any) => d.recommendedDelta > 0).length;

    return [
        "# AUTH comparison",
        `- Left: ${leftDir}`,
        `- Right: ${rightDir}`,
        `- Latency p95 deltas: ${latencyUp} increased, ${latencyDown} decreased`,
        `- Cooldown deltas: rest +${restCooldownUp}, ftp +${ftpCooldownUp}`,
        `- Concurrency deltas: rest ${concurrency.restMaxInFlight}, ftp ${concurrency.ftpMaxSessions}, mixed ${concurrency.mixedMaxInFlight}`
    ].join("\n");
}

function readJson(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv: string[]) {
    const result: { left?: string; right?: string; out?: string } = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--left") {
            result.left = argv[i + 1];
            i += 1;
        } else if (argv[i] === "--right") {
            result.right = argv[i + 1];
            i += 1;
        } else if (argv[i] === "--out") {
            result.out = argv[i + 1];
            i += 1;
        }
    }
    return result;
}
