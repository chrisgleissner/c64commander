import { setTimeout as delay } from 'node:timers/promises';

export const sleep = (ms) => delay(ms);

export const sanitizeSegment = (value) => {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
};

export const nowIso = () => new Date().toISOString();
