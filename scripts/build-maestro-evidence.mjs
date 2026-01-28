#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const RAW_ROOT = path.resolve(ROOT, 'test-results', 'maestro');
const EVIDENCE_ROOT = path.resolve(ROOT, 'test-results', 'evidence', 'maestro');
const FLOWS_ROOT = path.resolve(ROOT, '.maestro');

const DEVICE_TYPE = process.env.MAESTRO_DEVICE_TYPE || 'android-emulator';
const MAESTRO_EXIT_CODE = Number(process.env.MAESTRO_EXIT_CODE ?? '0');

const statSafe = async (target) => {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
};

const walkFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
};

const listFlowFiles = async () => {
  const entries = await fs.readdir(FLOWS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml') && entry.name !== 'config.yaml')
    .map((entry) => path.join(FLOWS_ROOT, entry.name));
};

const parseAttributes = (raw) => {
  const attrs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(raw))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const parseJUnit = (xmlText) => {
  const entries = [];
  const testcaseRegex = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;
  let match;
  while ((match = testcaseRegex.exec(xmlText))) {
    const attrsRaw = match[1] || match[3] || '';
    const body = match[2] || '';
    const attrs = parseAttributes(attrsRaw);
    const name = attrs.name || attrs.classname || 'unknown';
    const timeSeconds = attrs.time ? Number(attrs.time) : 0;
    const durationMs = Number.isNaN(timeSeconds) ? undefined : Math.round(timeSeconds * 1000);
    const hasFailure = /<failure\b|<error\b/.test(body);
    const hasSkipped = /<skipped\b/.test(body);
    const status = hasFailure ? 'failed' : hasSkipped ? 'skipped' : 'passed';
    let message = undefined;
    const failureMatch = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/);
    if (failureMatch) {
      message = failureMatch[1].trim();
    }
    entries.push({ name, status, durationMs, message });
  }
  return entries;
};

const extractJsonEntries = (payload) => {
  const entries = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      const name = node.name || node.flow || node.test || node.title;
      const status = node.status || node.outcome || node.result;
      if (name && status) {
        entries.push({
          name: String(name),
          status: String(status).toLowerCase(),
          durationMs: typeof node.durationMs === 'number' ? node.durationMs : undefined,
          message: typeof node.message === 'string' ? node.message : undefined,
        });
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(payload);
  return entries;
};

const loadReportEntries = async (rawFiles) => {
  const reportCandidates = rawFiles.filter((file) => {
    const base = path.basename(file).toLowerCase();
    return [
      'report.xml',
      'report.json',
      'maestro-report.xml',
      'maestro-report.json',
      'results.xml',
      'results.json',
    ].includes(base);
  });
  for (const file of reportCandidates) {
    const content = await fs.readFile(file, 'utf8');
    if (file.endsWith('.xml')) {
      const entries = parseJUnit(content);
      if (entries.length) return entries;
    }
    if (file.endsWith('.json')) {
      try {
        const payload = JSON.parse(content);
        const entries = extractJsonEntries(payload);
        if (entries.length) return entries;
      } catch {
        // ignore
      }
    }
  }
  return [];
};

const matchEntryForFlow = (entries, flowName) => {
  const lower = flowName.toLowerCase();
  return entries.find((entry) => String(entry.name).toLowerCase().includes(lower));
};

const copyFile = async (src, dest) => {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
};

const normalizeStatus = (status) => {
  if (!status) return undefined;
  const lower = status.toLowerCase();
  if (lower.includes('pass')) return 'passed';
  if (lower.includes('skip')) return 'skipped';
  if (lower.includes('fail') || lower.includes('error')) return 'failed';
  return lower;
};

const buildEvidenceForFlow = async ({ flowName, rawFiles, reportEntries, allScreenshots, globalArtifacts }) => {
  const flowDir = path.join(EVIDENCE_ROOT, flowName, DEVICE_TYPE);
  await fs.mkdir(flowDir, { recursive: true });

  const flowMatches = rawFiles.filter((file) => file.toLowerCase().includes(flowName.toLowerCase()));
  let screenshots = flowMatches.filter((file) => file.toLowerCase().endsWith('.png'));
  if (screenshots.length === 0 && allScreenshots.length) {
    screenshots = allScreenshots;
  }

  const screenshotsDir = path.join(flowDir, 'screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  const sortedScreenshots = [...screenshots].sort();
  await Promise.all(sortedScreenshots.map((file, index) => {
    const targetName = `${String(index + 1).padStart(2, '0')}-${path.basename(file)}`;
    return copyFile(file, path.join(screenshotsDir, targetName));
  }));

  const videos = flowMatches.filter((file) => ['.mp4', '.webm'].includes(path.extname(file).toLowerCase()));
  if (videos.length > 0) {
    const selected = videos.find((file) => file.toLowerCase().endsWith('.mp4')) ?? videos[0];
    const ext = path.extname(selected).toLowerCase();
    await copyFile(selected, path.join(flowDir, `video${ext}`));
  }

  const logs = flowMatches.filter((file) => ['.log', '.txt'].includes(path.extname(file).toLowerCase()));
  for (const log of logs) {
    await copyFile(log, path.join(flowDir, path.basename(log)));
  }

  for (const artifact of globalArtifacts) {
    await copyFile(artifact, path.join(flowDir, path.basename(artifact)));
  }

  const reportEntry = matchEntryForFlow(reportEntries, flowName);
  const status = normalizeStatus(reportEntry?.status) ?? (MAESTRO_EXIT_CODE === 0 ? 'passed' : 'failed');

  const meta = {
    flow: flowName,
    status,
    durationMs: reportEntry?.durationMs,
    deviceType: DEVICE_TYPE,
    rawOutputRoot: RAW_ROOT,
    capturedAt: new Date().toISOString(),
    artifacts: {
      screenshots: sortedScreenshots.length,
      videos: videos.length,
      logs: logs.length,
    },
  };

  await fs.writeFile(path.join(flowDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const errorContext = [
    `Project: maestro`,
    `Flow: ${flowName}`,
    `Status: ${status}`,
  ];
  if (reportEntry?.message) {
    errorContext.push('', 'Failure:', reportEntry.message);
  }

  await fs.writeFile(path.join(flowDir, 'error-context.md'), errorContext.join('\n'));
};

const main = async () => {
  const rawStat = await statSafe(RAW_ROOT);
  if (!rawStat?.isDirectory()) {
    throw new Error(`Raw Maestro output directory missing: ${RAW_ROOT}`);
  }

  const flowFiles = await listFlowFiles();
  if (flowFiles.length === 0) {
    throw new Error('No Maestro flows found in .maestro');
  }

  const rawFiles = await walkFiles(RAW_ROOT);
  const reportEntries = await loadReportEntries(rawFiles);

  const allScreenshots = rawFiles.filter((file) => file.toLowerCase().endsWith('.png'));
  const globalArtifacts = rawFiles.filter((file) => {
    const base = path.basename(file).toLowerCase();
    return [
      'maestro.log',
      'report.xml',
      'report.json',
      'maestro-report.xml',
      'maestro-report.json',
      'logcat.txt',
      'emulator.log',
    ].includes(base);
  });

  await fs.mkdir(EVIDENCE_ROOT, { recursive: true });

  for (const flowFile of flowFiles) {
    const flowName = path.basename(flowFile, '.yaml');
    await buildEvidenceForFlow({ flowName, rawFiles, reportEntries, allScreenshots, globalArtifacts });
  }

  console.log(`Maestro evidence written to ${EVIDENCE_ROOT}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
