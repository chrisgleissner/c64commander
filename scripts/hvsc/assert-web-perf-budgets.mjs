#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value] = arg.split('=');
        return [key, value ?? ''];
    }),
);

const filePath =
    args.get('--file') || process.env.HVSC_PERF_SUMMARY_FILE || 'ci-artifacts/hvsc-performance/web/web-secondary-quick.json';
const summary = JSON.parse(readFileSync(filePath, 'utf8'));

const budgets = [
    ['browseLoadSnapshotMs', process.env.HVSC_BUDGET_BROWSE_LOAD_SNAPSHOT_P95],
    ['browseInitialQueryMs', process.env.HVSC_BUDGET_BROWSE_QUERY_P95],
    ['browseSearchQueryMs', process.env.HVSC_BUDGET_BROWSE_SEARCH_P95],
    ['playbackLoadSidMs', process.env.HVSC_BUDGET_PLAYBACK_LOAD_SID_P95],
].filter(([, budget]) => budget);

if (budgets.length === 0) {
    process.stdout.write('No web secondary HVSC perf budgets configured; summary retained for observation only.\n');
    process.exit(0);
}

const failures = [];
for (const [metricName, budgetValue] of budgets) {
    const budget = Number(budgetValue);
    const actual = Number(summary.metrics?.[metricName]?.p95 ?? NaN);
    if (!Number.isFinite(actual)) {
        failures.push(`${metricName}: missing p95 sample`);
        continue;
    }
    if (actual > budget) {
        failures.push(`${metricName}: p95 ${actual}ms exceeds ${budget}ms`);
    }
}

if (failures.length > 0) {
    process.stderr.write(`HVSC web secondary perf budgets failed:\n- ${failures.join('\n- ')}\n`);
    process.exit(1);
}

process.stdout.write('HVSC web secondary perf budgets passed.\n');
