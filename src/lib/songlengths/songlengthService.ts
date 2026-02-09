/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from '@/lib/logging';
import type { SongLengthStoreBackend } from './songlengthBackend';
import type {
  SongLengthResolution,
  SongLengthResolveQuery,
  SongLengthServiceStats,
  SongLengthSourceFile,
} from './songlengthTypes';

type SongLengthSourceLoader = () => Promise<SongLengthSourceFile[]>;

type SongLengthServiceOptions = {
  serviceId: string;
};

const safeAddLog = (level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: unknown) => {
  try {
    addLog(level, message, details);
  } catch (error) {
    if (typeof window === 'undefined') return;
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('SongLengthServiceFacade logging failed', {
        level,
        message,
        details,
        error: (error as Error).message,
      });
    }
  }
};

const safeAddErrorLog = (message: string, details?: unknown) => {
  try {
    addErrorLog(message, details);
  } catch (error) {
    if (typeof window === 'undefined') return;
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('SongLengthServiceFacade error logging failed', {
        message,
        details,
        error: (error as Error).message,
      });
    }
  }
};

export class SongLengthServiceFacade {
  private status: SongLengthServiceStats['status'] = 'unavailable';
  private unavailableReason: string | null = 'not loaded';
  private lastLoadedAtIso: string | null = null;
  private loadDurationMs: number | null = null;
  private configuredPathOrDefault: string | null = null;

  constructor(
    private readonly backend: SongLengthStoreBackend,
    private readonly options: SongLengthServiceOptions,
  ) {}

  private async loadInternal(
    trigger: 'cold-start' | 'config-change',
    configuredPathOrDefault: string | null,
    loadSources: SongLengthSourceLoader,
    sourceLabel: string,
  ): Promise<SongLengthServiceStats> {
    this.status = 'loading';
    this.unavailableReason = null;
    this.configuredPathOrDefault = configuredPathOrDefault;
    const startedAtMs = Date.now();
    safeAddLog('info', 'Songlengths load started', {
      service: this.options.serviceId,
      trigger,
      configuredPath: configuredPathOrDefault,
      sourceLabel,
    });

    try {
      const files = await loadSources();
      if (!files.length) {
        this.backend.reset();
        this.status = 'unavailable';
        this.unavailableReason = 'songlengths unavailable';
        this.loadDurationMs = Date.now() - startedAtMs;
        this.lastLoadedAtIso = new Date().toISOString();
        safeAddLog('warn', 'Songlengths unavailable', {
          service: this.options.serviceId,
          trigger,
          configuredPath: configuredPathOrDefault,
          sourceLabel,
          loadDurationMs: this.loadDurationMs,
        });
        return this.stats();
      }

      await this.backend.load({
        configuredPath: configuredPathOrDefault,
        sourceLabel,
        files,
      });
      this.status = 'ready';
      this.unavailableReason = null;
      this.loadDurationMs = Date.now() - startedAtMs;
      this.lastLoadedAtIso = new Date().toISOString();
      const backendStats = this.backend.stats();
      safeAddLog('info', 'Songlengths load completed', {
        service: this.options.serviceId,
        trigger,
        configuredPath: configuredPathOrDefault,
        sourceLabel,
        filesLoaded: backendStats.filesLoaded,
        loadDurationMs: this.loadDurationMs,
      });
      safeAddLog('info', 'Songlengths status summary', {
        service: this.options.serviceId,
        status: this.status,
        entriesTotal: backendStats.entriesTotal,
        uniqueFileNames: backendStats.uniqueFileNames,
        duplicatedFileNames: backendStats.duplicatedFileNames,
        duplicateEntries: backendStats.duplicateEntries,
        rejectedLines: backendStats.rejectedLines,
        fullPathIndexSize: backendStats.fullPathIndexSize,
        md5IndexSize: backendStats.md5IndexSize,
        estimatedMemoryBytes: backendStats.estimatedMemoryBytes,
        configuredPath: configuredPathOrDefault,
      });
      return this.stats();
    } catch (error) {
      this.backend.reset();
      this.status = 'unavailable';
      this.unavailableReason = 'songlengths unavailable';
      this.loadDurationMs = Date.now() - startedAtMs;
      this.lastLoadedAtIso = new Date().toISOString();
      const err = error as Error;
      safeAddErrorLog('Songlengths load failed', {
        service: this.options.serviceId,
        trigger,
        configuredPath: configuredPathOrDefault,
        sourceLabel,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
        loadDurationMs: this.loadDurationMs,
      });
      return this.stats();
    }
  }

  async loadOnColdStart(
    configuredPathOrDefault: string | null,
    loadSources: SongLengthSourceLoader,
    sourceLabel: string,
  ): Promise<SongLengthServiceStats> {
    return this.loadInternal('cold-start', configuredPathOrDefault, loadSources, sourceLabel);
  }

  async reloadOnConfigChange(
    configuredPathOrDefault: string | null,
    loadSources: SongLengthSourceLoader,
    sourceLabel: string,
  ): Promise<SongLengthServiceStats> {
    return this.loadInternal('config-change', configuredPathOrDefault, loadSources, sourceLabel);
  }

  resolveDurationSeconds(query: SongLengthResolveQuery): SongLengthResolution {
    if (this.status !== 'ready') {
      return {
        durationSeconds: null,
        strategy: 'unavailable',
      };
    }
    const resolution = this.backend.resolve(query);
    safeAddLog('debug', 'Songlengths resolve strategy', {
      service: this.options.serviceId,
      strategy: resolution.strategy,
      query: {
        virtualPath: query.virtualPath ?? null,
        fileName: query.fileName ?? null,
        partialPath: query.partialPath ?? null,
        md5: query.md5 ? '<provided>' : null,
        songNr: query.songNr ?? null,
      },
      matchedPath: resolution.matchedPath ?? null,
      candidateCount: resolution.candidateCount ?? null,
    });
    return resolution;
  }

  reset(reason = 'manual-reset') {
    this.backend.reset();
    this.status = 'unavailable';
    this.unavailableReason = reason;
    safeAddLog('warn', 'Songlengths reset', {
      service: this.options.serviceId,
      reason,
      configuredPath: this.configuredPathOrDefault,
    });
  }

  stats(): SongLengthServiceStats {
    return {
      status: this.status,
      unavailableReason: this.unavailableReason,
      loadDurationMs: this.loadDurationMs,
      lastLoadedAtIso: this.lastLoadedAtIso,
      backendStats: this.backend.stats(),
    };
  }
}
