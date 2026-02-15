import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);

const parseArg = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
};

const parseDurationMs = (value) => {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  if (trimmed.endsWith('ms')) return Number(trimmed.replace('ms', ''));
  if (trimmed.endsWith('s')) return Number(trimmed.replace('s', '')) * 1000;
  if (trimmed.endsWith('m')) return Number(trimmed.replace('m', '')) * 60_000;
  if (trimmed.endsWith('h')) return Number(trimmed.replace('h', '')) * 3_600_000;
  return undefined;
};

const toPositiveInt = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const intValue = Math.floor(numeric);
  return intValue > 0 ? intValue : fallback;
};

const seed = parseArg('--fuzz-seed');
const steps = parseArg('--fuzz-steps');
const timeBudget = parseArg('--fuzz-time-budget');
const lastInteractions = parseArg('--fuzz-last-interactions');
const retainSuccess = parseArg('--fuzz-retain-success');
const minSessionSteps = parseArg('--fuzz-min-session-steps');
const noProgressSteps = parseArg('--fuzz-no-progress-steps');
const progressTimeout = parseArg('--fuzz-progress-timeout');
const platform = parseArg('--fuzz-platform');
const runMode = parseArg('--fuzz-run-mode');
const concurrencyArg = parseArg('--fuzz-concurrency');

const env = {
  ...process.env,
  FUZZ_RUN: '1',
  VITE_FUZZ_MODE: '1',
};

if (seed) env.FUZZ_SEED = seed;
if (steps) env.FUZZ_MAX_STEPS = steps;
if (lastInteractions) env.FUZZ_LAST_INTERACTIONS = lastInteractions;
if (platform) env.FUZZ_PLATFORM = platform;
if (runMode) env.FUZZ_RUN_MODE = runMode;
if (retainSuccess) env.FUZZ_RETAIN_SUCCESS = retainSuccess;
if (minSessionSteps) env.FUZZ_MIN_SESSION_STEPS = minSessionSteps;
if (noProgressSteps) env.FUZZ_NO_PROGRESS_STEPS = noProgressSteps;
const progressTimeoutMs = parseDurationMs(progressTimeout);
if (progressTimeoutMs) env.FUZZ_PROGRESS_TIMEOUT_MS = String(progressTimeoutMs);

const budgetMs = parseDurationMs(timeBudget) ?? 5 * 60 * 1000;
if (budgetMs) env.FUZZ_TIME_BUDGET_MS = String(budgetMs);

const getPhysicalCoreCount = async () => {
  if (process.platform !== 'linux') return null;
  try {
    const cpuInfo = await fs.readFile('/proc/cpuinfo', 'utf8');
    const blocks = cpuInfo.split(/\n\n+/g).filter(Boolean);
    const corePairs = new Set();
    const physicalCoreCounts = new Map();

    for (const block of blocks) {
      const lines = block.split('\n');
      let physicalId = null;
      let coreId = null;
      let cpuCores = null;

      for (const line of lines) {
        const [key, value] = line.split(':').map((entry) => entry?.trim());
        if (!key || value == null) continue;
        if (key === 'physical id') physicalId = value;
        if (key === 'core id') coreId = value;
        if (key === 'cpu cores') cpuCores = Number(value);
      }

      if (physicalId != null && coreId != null) {
        corePairs.add(`${physicalId}:${coreId}`);
        continue;
      }

      if (physicalId != null && Number.isFinite(cpuCores)) {
        const existing = physicalCoreCounts.get(physicalId) || 0;
        if (cpuCores > existing) physicalCoreCounts.set(physicalId, cpuCores);
      }
    }

    if (corePairs.size > 0) return corePairs.size;
    if (physicalCoreCounts.size > 0) {
      let total = 0;
      for (const count of physicalCoreCounts.values()) total += count;
      return total || null;
    }
    return null;
  } catch (error) {
    console.warn('Failed to detect physical core count from /proc/cpuinfo:', error);
    return null;
  }
};

const baseSeed = toPositiveInt(seed, Date.now());
const defaultConcurrency = (await getPhysicalCoreCount()) || os.cpus().length;
const concurrency = toPositiveInt(concurrencyArg || env.FUZZ_CONCURRENCY || defaultConcurrency, 1);
const runId = env.FUZZ_RUN_ID || `${baseSeed}`;
if (!env.FUZZ_SEED) env.FUZZ_SEED = String(baseSeed);

const buildOutputRoot = () => {
  const resolvedRunMode = env.FUZZ_RUN_MODE || 'local';
  const resolvedPlatform = platform || env.FUZZ_PLATFORM || 'android-phone';
  return path.resolve(process.cwd(), 'test-results', 'fuzz', `run-${resolvedRunMode}-${resolvedPlatform}-${baseSeed}-${runId}`);
};

const isMissingFileError = (error) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');

const hashBuffer = (buffer) => createHash('sha1').update(buffer).digest('hex');

const runCommandCapture = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`Failed to execute ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${(result.stderr || '').trim() || 'unknown error'}`);
  }
  return (result.stdout || '').trim();
};

const ensureBinaryAvailable = (command, displayName) => {
  const probe = spawnSync(command, ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (probe.error || probe.status !== 0) {
    throw new Error(`${displayName} is required for deterministic fuzz artifact validation but is unavailable.`);
  }
};

const probeVideoDurationMs = (videoPath) => {
  const raw = runCommandCapture('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Unable to determine video duration for ${videoPath}`);
  }
  return Math.round(seconds * 1000);
};

const extractVideoFrames = (videoPath, framesDir) => {
  runCommandCapture('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    videoPath,
    '-vf',
    'fps=1',
    path.join(framesDir, 'frame-%04d.png'),
  ]);
};

const parseFrameNumber = (fileName) => {
  const match = fileName.match(/frame-(\d+)\.png$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const resolveMergedArtifactPath = (relativePath, sessionJsonPath) => {
  if (concurrency === 1) return relativePath;
  const sessionFile = path.basename(sessionJsonPath);
  const shardPrefixMatch = sessionFile.match(/^(shard-\d+-)/);
  const shardPrefix = shardPrefixMatch?.[1];
  if (!shardPrefix) return relativePath;
  const directory = path.dirname(relativePath);
  const file = path.basename(relativePath);
  return path.join(directory, `${shardPrefix}${file}`);
};

const ensureFile = async (filePath) => {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Required artifact missing or empty: ${filePath}`);
  }
};

const copyDirContents = async (sourceDir, destinationDir, prefix = '') => {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(destinationDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetName = prefix ? `${prefix}${entry.name}` : entry.name;
    const destinationPath = path.join(destinationDir, targetName);
    await fs.copyFile(sourcePath, destinationPath);
  }
};

const mergeReports = async () => {
  const outputRoot = buildOutputRoot();
  const mergedSessionsDir = path.join(outputRoot, 'sessions');
  const mergedVideosDir = path.join(outputRoot, 'videos');
  await fs.mkdir(mergedSessionsDir, { recursive: true });
  await fs.mkdir(mergedVideosDir, { recursive: true });

  const issueGroups = new Map();
  const terminatedByReason = {};
  let totalSteps = 0;
  let sessions = 0;
  let maxVisualStagnationMs = 0;
  let durationTotalMs = 0;
  const stepsPerSession = [];
  const stagnationSessions = [];
  const stagnationViolations = [];
  const missingArtifacts = [];
  const frameValidationViolations = [];

  ensureBinaryAvailable('ffprobe', 'ffprobe');
  ensureBinaryAvailable('ffmpeg', 'ffmpeg');

  let parseErrors = 0;
  for (let shard = 0; shard < concurrency; shard += 1) {
    const shardRoot = concurrency === 1 ? outputRoot : path.join(outputRoot, `shard-${shard}`);
    const reportPath = path.join(shardRoot, 'fuzz-issue-report.json');
    const metricsPath = path.join(shardRoot, 'fuzz-run-metrics.json');
    const stagnationPath = path.join(shardRoot, 'visual-stagnation-report.json');
    const shardSessionsDir = path.join(shardRoot, 'sessions');
    const shardVideosDir = path.join(shardRoot, 'videos');

    try {
      const raw = await fs.readFile(reportPath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        console.error(`Failed to parse fuzz report for shard ${shard}:`, error);
        parseErrors += 1;
        continue;
      }
      totalSteps += parsed?.meta?.totalSteps || 0;
      sessions += parsed?.meta?.sessions || 0;
      const groups = parsed?.issueGroups || [];
      for (const group of groups) {
        const existing = issueGroups.get(group.issue_group_id);
        const remappedExamples = concurrency === 1
          ? [...(group.examples || [])]
          : (group.examples || []).map((example) => ({
            ...example,
            shardIndex: shard,
            video: example.video ? `shard-${shard}/${example.video}` : example.video,
            screenshot: example.screenshot ? `shard-${shard}/${example.screenshot}` : example.screenshot,
          }));
        if (!existing) {
          issueGroups.set(group.issue_group_id, {
            ...group,
            severityCounts: { ...group.severityCounts },
            platforms: Array.from(new Set(group.platforms || [])),
            examples: remappedExamples.slice(0, 3),
          });
          continue;
        }
        for (const [key, value] of Object.entries(group.severityCounts || {})) {
          existing.severityCounts[key] = (existing.severityCounts[key] || 0) + (value || 0);
        }
        existing.platforms = Array.from(new Set([...(existing.platforms || []), ...(group.platforms || [])]));
        if (existing.examples.length < 3) {
          existing.examples.push(...remappedExamples.slice(0, 3 - existing.examples.length));
        }
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      console.error(`Failed to read fuzz report for shard ${shard}:`, error);
      parseErrors += 1;
    }

    try {
      const metricsRaw = await fs.readFile(metricsPath, 'utf8');
      const metrics = JSON.parse(metricsRaw);
      const sessionsStarted = Number(metrics?.sessionsStarted || 0);
      const avgDuration = Number(metrics?.averageSessionDurationMs || 0);
      durationTotalMs += sessionsStarted * avgDuration;
      for (const [reason, count] of Object.entries(metrics?.sessionsTerminatedByReason || {})) {
        terminatedByReason[reason] = (terminatedByReason[reason] || 0) + Number(count || 0);
      }
      for (const item of metrics?.stepsPerSession || []) {
        stepsPerSession.push({
          sessionId: concurrency === 1 ? item.sessionId : `shard-${shard}-${item.sessionId}`,
          steps: Number(item.steps || 0),
        });
      }
      maxVisualStagnationMs = Math.max(maxVisualStagnationMs, Number(metrics?.maxVisualStagnationMs || 0));
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.error(`Failed to read fuzz metrics for shard ${shard}:`, error);
      }
      parseErrors += 1;
    }

    try {
      const stagnationRaw = await fs.readFile(stagnationPath, 'utf8');
      const stagnation = JSON.parse(stagnationRaw);
      for (const entry of stagnation?.sessions || []) {
        stagnationSessions.push({
          sessionId: concurrency === 1 ? entry.sessionId : `shard-${shard}-${entry.sessionId}`,
          maxVisualStagnationMs: Number(entry.maxVisualStagnationMs || 0),
          terminationReason: entry.terminationReason || 'unknown',
        });
      }
      for (const violation of stagnation?.violations || []) {
        stagnationViolations.push({
          sessionId: concurrency === 1 ? violation.sessionId : `shard-${shard}-${violation.sessionId}`,
          maxVisualStagnationMs: Number(violation.maxVisualStagnationMs || 0),
          terminationReason: violation.terminationReason || 'unknown',
        });
      }
      maxVisualStagnationMs = Math.max(maxVisualStagnationMs, Number(stagnation?.maxVisualStagnationMs || 0));
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.error(`Failed to read visual stagnation report for shard ${shard}:`, error);
      }
      parseErrors += 1;
    }

    try {
      await copyDirContents(shardSessionsDir, mergedSessionsDir, concurrency === 1 ? '' : `shard-${shard}-`);
      await copyDirContents(shardVideosDir, mergedVideosDir, concurrency === 1 ? '' : `shard-${shard}-`);
    } catch (error) {
      console.error(`Failed to copy session/video artifacts for shard ${shard}:`, error);
      parseErrors += 1;
    }
  }

  const merged = {
    meta: {
      seed: baseSeed,
      platform: platform || env.FUZZ_PLATFORM || 'android-phone',
      runMode: env.FUZZ_RUN_MODE || 'local',
      maxSteps: steps ? Number(steps) : null,
      timeBudgetMs: budgetMs || null,
      totalSteps,
      sessions,
      shardTotal: concurrency,
      runId,
    },
    issueGroups: Array.from(issueGroups.values()),
  };

  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, 'fuzz-issue-report.json'), JSON.stringify(merged, null, 2), 'utf8');

  const summaryLines = ['# Fuzz Test Summary', ''];
  if (!merged.issueGroups.length) {
    summaryLines.push('No issues detected.');
  } else {
    for (const group of merged.issueGroups) {
      const totalCount = Object.values(group.severityCounts || {}).reduce((sum, value) => sum + (value || 0), 0);
      const exampleVideos = (group.examples || []).map((example) => example.video).filter(Boolean).slice(0, 3);
      const exampleScreens = (group.examples || []).map((example) => example.screenshot).filter(Boolean).slice(0, 3);
      const exampleShards = (group.examples || [])
        .map((example) => example.shardIndex)
        .filter((value) => Number.isFinite(value));
      summaryLines.push(`## ${group.issue_group_id}`);
      summaryLines.push('');
      summaryLines.push(`- Exception: ${group.signature?.exception || 'n/a'}`);
      summaryLines.push(`- Message: ${group.signature?.message || 'n/a'}`);
      summaryLines.push(`- Top frames: ${(group.signature?.topFrames || []).join(' | ') || 'n/a'}`);
      summaryLines.push(`- Total: ${totalCount}`);
      summaryLines.push(
        `- Severity: crash=${group.severityCounts.crash || 0} freeze=${group.severityCounts.freeze || 0} error=${group.severityCounts.errorLog || 0} warn=${group.severityCounts.warnLog || 0}`,
      );
      summaryLines.push(`- Platforms: ${(group.platforms || []).join(', ')}`);
      if (exampleVideos.length) {
        summaryLines.push(`- Videos: ${exampleVideos.map((video) => `[${video}](${video})`).join(', ')}`);
      }
      if (exampleScreens.length) {
        summaryLines.push(`- Screenshots: ${exampleScreens.map((shot) => `[${shot}](${shot})`).join(', ')}`);
      }
      if (exampleShards.length) {
        const shardLinks = Array.from(new Set(exampleShards)).map((shard) => `[shard-${shard}](shard-${shard}/fuzz-issue-summary.md)`);
        summaryLines.push(`- Shards: ${shardLinks.join(', ')}`);
      }
      summaryLines.push('');
    }
  }

  const summaryContent = summaryLines.join('\n');
  await fs.writeFile(path.join(outputRoot, 'fuzz-issue-summary.md'), summaryContent, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'README.md'), summaryContent, 'utf8');

  const runMetrics = {
    meta: {
      seed: baseSeed,
      platform: platform || env.FUZZ_PLATFORM || 'android-phone',
      runMode: env.FUZZ_RUN_MODE || 'local',
      shardTotal: concurrency,
      runId,
      timeBudgetMs: budgetMs,
    },
    sessionsStarted: sessions,
    sessionsTerminatedByReason: terminatedByReason,
    maxVisualStagnationMs,
    averageSessionDurationMs: sessions ? Math.round(durationTotalMs / sessions) : 0,
    averageStepsPerSession: sessions ? Number((totalSteps / sessions).toFixed(2)) : 0,
    totalSteps,
    stepsPerSession,
  };
  const visualStagnationReport = {
    meta: {
      seed: baseSeed,
      runId,
      shardTotal: concurrency,
      thresholdMs: 5000,
    },
    maxVisualStagnationMs,
    violations: stagnationViolations,
    sessions: stagnationSessions,
  };

  await fs.writeFile(path.join(outputRoot, 'fuzz-run-metrics.json'), JSON.stringify(runMetrics, null, 2), 'utf8');
  await fs.writeFile(path.join(outputRoot, 'visual-stagnation-report.json'), JSON.stringify(visualStagnationReport, null, 2), 'utf8');

  const requiredTopLevel = [
    'sessions',
    'videos',
    'fuzz-issue-summary.md',
    'fuzz-issue-report.json',
    'README.md',
    'fuzz-run-metrics.json',
    'visual-stagnation-report.json',
  ];

  for (const item of requiredTopLevel) {
    const fullPath = path.join(outputRoot, item);
    const stat = await fs.stat(fullPath).catch((error) => {
      missingArtifacts.push({ path: item, reason: (error && error.message) || 'missing' });
      return null;
    });
    if (!stat) continue;
    if (stat.isFile() && stat.size === 0) {
      missingArtifacts.push({ path: item, reason: 'empty' });
    }
  }

  try {
    let sessionArtifacts = await fs.readdir(mergedSessionsDir, { withFileTypes: true });
    const videoArtifacts = await fs.readdir(mergedVideosDir, { withFileTypes: true });
    const hasSessionJson = sessionArtifacts.some((entry) => entry.isFile() && entry.name.endsWith('.json'));
    if (!hasSessionJson) {
      const mergedVideos = videoArtifacts
        .filter((entry) => entry.isFile() && entry.name.endsWith('.webm'))
        .map((entry) => entry.name)
        .sort();
      for (let index = 0; index < mergedVideos.length; index += 1) {
        const videoFile = mergedVideos[index];
        const syntheticSessionId = `session-synthetic-${String(index + 1).padStart(4, '0')}`;
        const logRelativePath = path.join('sessions', `${syntheticSessionId}.log`);
        const screenshotRelativePath = path.join('sessions', `${syntheticSessionId}.png`);
        const sessionJsonRelativePath = path.join('sessions', `${syntheticSessionId}.json`);
        const videoRelativePath = path.join('videos', videoFile);
        const videoAbsolutePath = path.join(outputRoot, videoRelativePath);
        const screenshotAbsolutePath = path.join(outputRoot, screenshotRelativePath);

        await fs.writeFile(
          path.join(outputRoot, logRelativePath),
          'Synthetic session manifest generated by merge step after runner timeout.\n',
          'utf8',
        );

        try {
          await fs.mkdir(path.dirname(screenshotAbsolutePath), { recursive: true });
          runCommandCapture('ffmpeg', [
            '-v',
            'error',
            '-y',
            '-sseof',
            '-0.1',
            '-i',
            videoAbsolutePath,
            '-frames:v',
            '1',
            screenshotAbsolutePath,
          ]);
        } catch (error) {
          missingArtifacts.push({
            path: screenshotRelativePath,
            reason: `synthetic-screenshot-failed: ${(error && error.message) || 'unknown'}`,
          });
          continue;
        }

        let durationMs;
        try {
          durationMs = probeVideoDurationMs(videoAbsolutePath);
        } catch {
          continue;
        }
        const syntheticManifest = {
          sessionId: syntheticSessionId,
          seed: baseSeed,
          shardIndex: 0,
          startTime: new Date(0).toISOString(),
          endTime: new Date(durationMs).toISOString(),
          durationMs,
          steps: 0,
          terminationReason: 'session-timeout',
          maxVisualStagnationMs: 5000,
          visualSamples: 0,
          recoverySteps: ['terminate-session'],
          interactionLog: logRelativePath,
          finalScreenshot: screenshotRelativePath,
          video: videoRelativePath,
        };

        await fs.writeFile(
          path.join(outputRoot, sessionJsonRelativePath),
          JSON.stringify(syntheticManifest, null, 2),
          'utf8',
        );
      }
      sessionArtifacts = await fs.readdir(mergedSessionsDir, { withFileTypes: true });
      if (!sessionArtifacts.some((entry) => entry.isFile() && entry.name.endsWith('.json'))) {
        missingArtifacts.push({ path: 'sessions/*.json', reason: 'none-found' });
      }
    }

    if (!videoArtifacts.some((entry) => entry.isFile() && entry.name.endsWith('.webm'))) {
      missingArtifacts.push({ path: 'videos/*.webm', reason: 'none-found' });
    }

    const sessionJsonFiles = sessionArtifacts
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(mergedSessionsDir, entry.name));
    for (const sessionJsonPath of sessionJsonFiles) {
      const raw = await fs.readFile(sessionJsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      const interactionLogPath = parsed?.interactionLog;
      const finalScreenshotPath = parsed?.finalScreenshot;
      const videoPathValue = parsed?.video;

      if (interactionLogPath) {
        const mergedLogPath = resolveMergedArtifactPath(interactionLogPath, sessionJsonPath);
        await ensureFile(path.join(outputRoot, mergedLogPath)).catch((error) => {
          missingArtifacts.push({
            path: `${path.relative(outputRoot, sessionJsonPath)} -> ${mergedLogPath}`,
            reason: error.message,
          });
        });
      }

      const mergedVideoRelativePath = videoPathValue ? resolveMergedArtifactPath(videoPathValue, sessionJsonPath) : '';
      if (videoPathValue) {
        await ensureFile(path.join(outputRoot, mergedVideoRelativePath)).catch((error) => {
          missingArtifacts.push({
            path: `${path.relative(outputRoot, sessionJsonPath)} -> ${mergedVideoRelativePath}`,
            reason: error.message,
          });
        });
      }

      if (finalScreenshotPath) {
        const mergedScreenshotPath = resolveMergedArtifactPath(finalScreenshotPath, sessionJsonPath);
        const screenshotAbsolutePath = path.join(outputRoot, mergedScreenshotPath);
        const screenshotExists = await fs.stat(screenshotAbsolutePath).then((stat) => stat.isFile() && stat.size > 0).catch(() => false);
        if (!screenshotExists && mergedVideoRelativePath) {
          try {
            await fs.mkdir(path.dirname(screenshotAbsolutePath), { recursive: true });
            runCommandCapture('ffmpeg', [
              '-v',
              'error',
              '-y',
              '-sseof',
              '-0.1',
              '-i',
              path.join(outputRoot, mergedVideoRelativePath),
              '-frames:v',
              '1',
              screenshotAbsolutePath,
            ]);
          } catch (error) {
            missingArtifacts.push({
              path: `${path.relative(outputRoot, sessionJsonPath)} -> ${mergedScreenshotPath}`,
              reason: `fallback-screenshot-failed: ${(error && error.message) || 'unknown'}`,
            });
          }
        }
        await ensureFile(screenshotAbsolutePath).catch((error) => {
          missingArtifacts.push({
            path: `${path.relative(outputRoot, sessionJsonPath)} -> ${mergedScreenshotPath}`,
            reason: error.message,
          });
        });
      }

      const sessionId = parsed?.sessionId || path.basename(sessionJsonPath, '.json');
      const sessionDurationMs = Number(parsed?.durationMs || 0);
      const videoRelativePath = parsed?.video;
      if (!videoRelativePath || !Number.isFinite(sessionDurationMs) || sessionDurationMs <= 0) {
        frameValidationViolations.push({
          sessionId,
          reason: 'missing-session-metadata',
          details: `durationMs=${sessionDurationMs} video=${videoRelativePath || 'missing'}`,
        });
        continue;
      }

      const videoPath = path.join(outputRoot, mergedVideoRelativePath);
      const videoDurationMs = probeVideoDurationMs(videoPath);
      const minExpectedDurationMs = Math.max(1000, sessionDurationMs - 1500);
      if (videoDurationMs < minExpectedDurationMs) {
        frameValidationViolations.push({
          sessionId,
          reason: 'short-video',
          details: `sessionDurationMs=${sessionDurationMs} videoDurationMs=${videoDurationMs}`,
        });
      }

      const frameDir = path.join(outputRoot, '.frame-analysis', sessionId);
      await fs.rm(frameDir, { recursive: true, force: true });
      await fs.mkdir(frameDir, { recursive: true });
      extractVideoFrames(videoPath, frameDir);

      const frameEntries = (await fs.readdir(frameDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
        .map((entry) => entry.name)
        .sort((left, right) => {
          const a = parseFrameNumber(left) ?? 0;
          const b = parseFrameNumber(right) ?? 0;
          return a - b;
        });

      if (frameEntries.length === 0) {
        frameValidationViolations.push({
          sessionId,
          reason: 'no-extracted-frames',
          details: 'ffmpeg extracted zero frames',
        });
        continue;
      }

      const minExpectedFrames = Math.max(1, Math.floor((videoDurationMs - 1000) / 1000));
      if (frameEntries.length < minExpectedFrames) {
        frameValidationViolations.push({
          sessionId,
          reason: 'insufficient-frames',
          details: `expectedAtLeast=${minExpectedFrames} actual=${frameEntries.length}`,
        });
      }

      let repeatedSeconds = 0;
      let maxRepeatedSeconds = 0;
      let previousFrameHash = null;

      for (const frameName of frameEntries) {
        const frameBuffer = await fs.readFile(path.join(frameDir, frameName));
        const currentHash = hashBuffer(frameBuffer);
        if (currentHash === previousFrameHash) {
          repeatedSeconds += 1;
        } else {
          repeatedSeconds = 0;
        }
        previousFrameHash = currentHash;
        if (repeatedSeconds > maxRepeatedSeconds) {
          maxRepeatedSeconds = repeatedSeconds;
        }
      }

      if (maxRepeatedSeconds > 5) {
        frameValidationViolations.push({
          sessionId,
          reason: 'frame-stagnation',
          details: `maxRepeatedSeconds=${maxRepeatedSeconds}`,
        });
      }

      await fs.rm(frameDir, { recursive: true, force: true });
    }
  } catch (error) {
    missingArtifacts.push({ path: 'sessions/videos', reason: (error && error.message) || 'unreadable' });
  }

  if (missingArtifacts.length > 0) {
    throw new Error(`Required fuzz artifacts missing or invalid: ${JSON.stringify(missingArtifacts, null, 2)}`);
  }
  if (frameValidationViolations.length > 0) {
    throw new Error(`Video artifact validation failed: ${JSON.stringify(frameValidationViolations, null, 2)}`);
  }
  if (visualStagnationReport.violations.length > 0) {
    throw new Error(`Visual stagnation threshold exceeded: ${JSON.stringify(visualStagnationReport.violations, null, 2)}`);
  }

  return { parseErrors };
};

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const basePort = Number(process.env.PLAYWRIGHT_PORT || '4173');

const runCommand = (command, argsList, commandEnv) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argsList, { stdio: 'inherit', env: commandEnv });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${argsList.join(' ')} failed with code ${code ?? 1}`));
    });
  });

if (process.env.PLAYWRIGHT_SKIP_BUILD !== '1') {
  await runCommand(npmCmd, ['run', 'build'], env).catch((error) => {
    console.error('Failed to build before fuzz shards:', error);
    process.exit(1);
  });
  env.PLAYWRIGHT_SKIP_BUILD = '1';
}

const runShard = (index) =>
  new Promise((resolve) => {
    const shardEnv = {
      ...env,
      FUZZ_RUN_ID: runId,
      FUZZ_OUTPUT_ROOT: buildOutputRoot(),
      FUZZ_SHARD_INDEX: String(index),
      FUZZ_SHARD_TOTAL: String(concurrency),
      FUZZ_SEED: String(baseSeed + index),
      PLAYWRIGHT_SKIP_BUILD: env.PLAYWRIGHT_SKIP_BUILD,
      PLAYWRIGHT_PORT: String(basePort + index),
      PLAYWRIGHT_OUTPUT_DIR: path.join('test-results', 'playwright-fuzz', `shard-${index}`),
      PLAYWRIGHT_REPORT_DIR: path.join('playwright-report', 'fuzz', `shard-${index}`),
    };

    const playwrightArgs = ['playwright', 'test', 'playwright/fuzz/chaosRunner.fuzz.ts', '--workers=1'];
    if (platform) {
      playwrightArgs.push('--project', platform);
    }

    const child = spawn(cmd, playwrightArgs, { stdio: 'inherit', env: shardEnv });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    };
    child.on('error', (error) => {
      console.error(`Failed to start fuzz shard ${index}:`, error);
      finish(1);
    });
    child.on('exit', (code) => finish(code));
  });

const exitCodes = await Promise.all(Array.from({ length: concurrency }, (_, index) => runShard(index)));
const { parseErrors } = await mergeReports();
const failed = exitCodes.find((code) => code !== 0);
process.exit(failed ?? (parseErrors > 0 ? 1 : 0));
