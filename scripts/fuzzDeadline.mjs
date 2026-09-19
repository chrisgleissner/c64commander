/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// The fuzz time budget is a deadline for the whole run, not a gate on starting
// sessions. Build, shard teardown and artifact validation all have to fit inside
// it, so a reserve is carved out of the budget for the work that follows the
// shards and the shards themselves get what is left.

export const DEFAULT_RESERVE_RATIO = 0.25;
export const MIN_RESERVE_MS = 60_000;
export const MAX_RESERVE_MS = 40 * 60_000;
export const MIN_SHARD_BUDGET_MS = 30_000;
export const MAX_SHARD_GRACE_MS = 120_000;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const computeReserveMs = (budgetMs, options = {}) => {
  const ratio = options.reserveRatio ?? DEFAULT_RESERVE_RATIO;
  const minimum = options.minReserveMs ?? MIN_RESERVE_MS;
  const maximum = options.maxReserveMs ?? MAX_RESERVE_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return minimum;
  return clamp(Math.floor(budgetMs * ratio), minimum, Math.min(maximum, budgetMs));
};

export const planFuzzDeadline = ({ budgetMs, startedAtMs, nowMs = startedAtMs, ...options }) => {
  const reserveMs = computeReserveMs(budgetMs, options);
  const deadlineMs = startedAtMs + budgetMs;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const remainingForShardsMs = deadlineMs - nowMs - reserveMs;
  const expired = remainingForShardsMs < MIN_SHARD_BUDGET_MS;
  // Shards that overrun their own budget are killed a little after it, so that
  // most of the reserve is still left for merging and validating artifacts.
  const shardGraceMs = Math.min(MAX_SHARD_GRACE_MS, Math.floor(reserveMs / 4));
  return {
    deadlineMs,
    reserveMs,
    elapsedMs,
    expired,
    shardGraceMs,
    shardBudgetMs: expired ? 0 : remainingForShardsMs,
    shardHardStopMs: deadlineMs - reserveMs + shardGraceMs,
  };
};

export const remainingMs = (deadlineMs, nowMs) => Math.max(0, deadlineMs - nowMs);

export const hasDeadlinePassed = (deadlineMs, nowMs) => nowMs >= deadlineMs;

export const shouldStartWork = (deadlineMs, nowMs, minimumWorkMs = 0) =>
  deadlineMs - nowMs >= Math.max(0, minimumWorkMs);

export const formatRemaining = (deadlineMs, nowMs) => {
  const left = remainingMs(deadlineMs, nowMs);
  const totalSeconds = Math.round(left / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
};
