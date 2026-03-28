import { promises as fs } from 'node:fs';
import path from 'node:path';

const SHARD_LOCAL_ARTIFACT_PATH_PATTERN = /shard-\d+\//;

const toPosixRelativePath = (relativePath) =>
  typeof relativePath === 'string'
    ? relativePath.replace(/\\/g, '/')
    : relativePath;

export const resolveMergedShardArtifactPath = (
  relativePath,
  shardIndex,
  shardTotal = 1,
) => {
  if (!relativePath || shardTotal <= 1) return relativePath;
  if (!Number.isInteger(shardIndex) || shardIndex < 0) return relativePath;

  const normalizedPath = toPosixRelativePath(relativePath);
  const shardPrefix = `shard-${shardIndex}-`;
  const directory = path.posix.dirname(normalizedPath);
  const fileName = path.posix.basename(normalizedPath);

  if (fileName.startsWith(shardPrefix)) {
    return normalizedPath;
  }

  return directory === '.'
    ? `${shardPrefix}${fileName}`
    : path.posix.join(directory, `${shardPrefix}${fileName}`);
};

export const resolveMergedSessionArtifactPath = (
  relativePath,
  sessionJsonPath,
  shardTotal = 1,
) => {
  if (!relativePath || shardTotal <= 1) return relativePath;

  const normalizedSessionJsonPath = toPosixRelativePath(sessionJsonPath);
  const sessionFileName = path.posix.basename(normalizedSessionJsonPath);
  const shardMatch = sessionFileName.match(/^shard-(\d+)-/);
  if (!shardMatch) return relativePath;

  return resolveMergedShardArtifactPath(
    relativePath,
    Number(shardMatch[1]),
    shardTotal,
  );
};

export const remapMergedIssueExamples = (
  examples = [],
  shardIndex,
  shardTotal = 1,
) =>
  (examples || []).map((example) => ({
    ...example,
    ...(shardTotal > 1 ? { shardIndex } : {}),
    video: resolveMergedShardArtifactPath(
      example.video,
      shardIndex,
      shardTotal,
    ),
    screenshot: resolveMergedShardArtifactPath(
      example.screenshot,
      shardIndex,
      shardTotal,
    ),
  }));

export const assertNoShardLocalArtifactPaths = (content, label) => {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const match = text.match(SHARD_LOCAL_ARTIFACT_PATH_PATTERN);
  if (!match) return;

  throw new Error(
    `${label} contains shard-local artifact paths (${match[0]}). Top-level merged reports must reference only canonical top-level sessions/ and videos/ artifacts.`,
  );
};

const directoryExists = async (directoryPath) => {
  try {
    const stat = await fs.stat(directoryPath);
    if (!stat.isDirectory()) {
      throw new Error(`Expected directory at ${directoryPath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

export const removeMergedShardDirectories = async (
  outputRoot,
  shardTotal = 1,
) => {
  if (shardTotal <= 1) return [];

  const removedDirectories = [];
  for (let shard = 0; shard < shardTotal; shard += 1) {
    const shardDirectory = path.join(outputRoot, `shard-${shard}`);
    const exists = await directoryExists(shardDirectory);
    if (!exists) continue;

    await fs.rm(shardDirectory, { recursive: true, force: true });
    const stillExists = await directoryExists(shardDirectory);
    if (stillExists) {
      throw new Error(`Failed to remove merged shard directory: ${shardDirectory}`);
    }
    removedDirectories.push(shardDirectory);
  }

  return removedDirectories;
};
