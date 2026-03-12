import { readFile } from 'node:fs/promises';
import path from 'node:path';

const profilePath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../android/app/src/main/assets/mock-timing-profile.json',
);

let cachedProfile = null;

const normalizeMethod = (method) => method.trim().toUpperCase();

export const loadMockTimingProfile = async () => {
  if (cachedProfile) return cachedProfile;
  const raw = await readFile(profilePath, 'utf8');
  cachedProfile = JSON.parse(raw);
  return cachedProfile;
};

export const resolveMockTimingClassId = (profile, method, pathname) => {
  const normalizedMethod = normalizeMethod(method);
  const matchedRule = profile.rules.find((rule) => {
    const methods = rule.methods.map(normalizeMethod);
    if (!methods.includes(normalizedMethod)) return false;
    if (rule.pathType === 'exact') return pathname === rule.path;
    if (rule.pathType === 'prefix') return pathname.startsWith(rule.path);
    return new RegExp(rule.path).test(pathname);
  });
  return matchedRule?.timingClass ?? profile.defaultClassId;
};

const resolveDeterministicJitterMs = (profile, timingClass, requestSequence) => {
  const range = Math.max(0, Math.round(timingClass.jitterRangeMs));
  if (range === 0) return 0;
  const seed = profile.seed + timingClass.jitterSeed * 13 + requestSequence * 17;
  return Math.abs(seed % (range + 1));
};

export const resolveMockTimingDelayMs = ({ profile, method, pathname, requestSequence }) => {
  const classId = resolveMockTimingClassId(profile, method, pathname);
  const timingClass = profile.classes[classId] ?? profile.classes[profile.defaultClassId];
  if (!timingClass) {
    throw new Error(`Mock timing class not found for ${classId}`);
  }
  return timingClass.baseDelayMs + resolveDeterministicJitterMs(profile, timingClass, requestSequence);
};