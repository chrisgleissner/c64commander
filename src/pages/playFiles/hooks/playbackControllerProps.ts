/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MutableRefObject } from "react";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import type { SidEnablement } from "@/lib/config/sidVolumeControl";
import type { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import type { SidMuteSnapshot } from "@/pages/playFiles/hooks/usePauseMute";
import type { AudioMixerItem } from "@/pages/playFiles/playFilesUtils";
import type { PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { RomDependencyAsk } from "@/pages/playFiles/resolveLocalRoute";
import type { RomDialogKind } from "@/pages/playFiles/romDependencyGate";
import type { PlaylistItem } from "@/pages/playFiles/types";
import type { VolumeAction } from "@/pages/playFiles/volumeState";

export type AutoAdvanceGuard = {
  trackInstanceId: number;
  dueAtMs: number;
  autoFired: boolean;
  userCancelled: boolean;
  deferredToEnd?: boolean;
};

export interface UsePlaybackControllerProps {
  playlist: PlaylistItem[];
  setPlaylist: React.Dispatch<React.SetStateAction<PlaylistItem[]>>;
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;

  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  isPaused: boolean;
  setIsPaused: (v: boolean) => void;
  setIsPlaylistLoading: (v: boolean) => void;

  playbackTime: PlaybackTimeStore;
  durationMs: number | undefined;
  setDurationMs: (v: number | undefined) => void;
  setCurrentSubsongCount: (v: number | null) => void;
  setTrackInstanceId: (v: number) => void;

  repeatOneEnabled?: boolean;
  stationFinishingRef?: { current: boolean };
  repeatEnabled: boolean;
  shuffleEnabled: boolean;
  /**
   * Whether a SID Radio station is choosing the tracks, read at the moment a skip is resolved.
   *
   * A ref rather than a value because the station hook is created after this one and depends on the
   * handlers it returns, so the flag cannot be passed in as a prop without reordering the two.
   */
  stationActiveRef?: { readonly current: boolean };
  shuffleSeed: number | null;
  shuffleAnchorId?: string | null;

  // Dependencies
  localEntriesBySourceId: Map<
    string,
    Map<
      string,
      {
        uri?: string | null;
        name: string;
        modifiedAt?: string | null;
        sizeBytes?: number | null;
      }
    >
  >;
  localSourceTreeUris: Map<string, string | null>;
  buildHvscLocalPlayFile?: (path: string, name: string) => LocalPlayFile | null | undefined;
  deviceProduct?: string | null;
  ensurePlaybackConnection: () => Promise<void>;
  resolveUnavailableConfigDecision?: (
    item: PlaylistItem,
    context: { configFileName: string | null; reason: string },
  ) => Promise<"play-without-config" | "cancel">;
  /** Asks the listener about a chosen song that needs the C64 ROMs. Absent: such a song is not played. */
  resolveRomDependencyDecision?: (item: PlaylistItem, kind: RomDialogKind) => ReturnType<RomDependencyAsk>;
  /**
   * A track the USER asked for has actually launched. Never fires for a playlist
   * moving on by itself, and never for a launch that failed.
   */
  onUserLaunchedItem?: (item: PlaylistItem) => void;
  resolveSonglengthDurationMsForPath: (
    path: string,
    file: LocalPlayFile | null,
    songNr: number | null,
  ) => Promise<number | null>;
  applySonglengthsToItems: (items: PlaylistItem[]) => Promise<PlaylistItem[]>;
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;

  // Volume Control
  restoreVolumeOverrides: (reason: string) => Promise<void>;
  /** Forgets the levels this phone would restore, without writing them, once the C64 belongs to someone else. */
  discardVolumeSession?: (reason: string) => void;
  applyAudioMixerUpdates: (updates: Record<string, string | number>, reason: string) => Promise<void>;
  enabledSidVolumeItems: AudioMixerItem[];
  buildEnabledSidMuteUpdates: (items: AudioMixerItem[], enablement: SidEnablement) => Record<string, string | number>;
  captureSidMuteSnapshot: (items: AudioMixerItem[], enablement: SidEnablement) => SidMuteSnapshot;
  snapshotToUpdates: (
    snapshot: SidMuteSnapshot | null | undefined,
    currentItems?: AudioMixerItem[],
  ) => Record<string, string | number>;
  resolveEnabledSidVolumeItems: (includeDisabled?: boolean) => Promise<AudioMixerItem[]>;
  dispatchVolume: React.Dispatch<VolumeAction>;
  sidEnablement: SidEnablement;
  pauseMuteSnapshotRef: MutableRefObject<SidMuteSnapshot | null>;
  pausingFromPauseRef: MutableRefObject<boolean>;
  resumingFromPauseRef: MutableRefObject<boolean>;
  ensureUnmuted: (options?: { force?: boolean; refreshItems?: boolean }) => Promise<void>;
  /** Whether the listener's own Mute is on, which a pause must hand back rather than undo. */
  isManualMuteHeld: () => boolean;

  // Refs
  // HARD12-007: the second parameter is `reset` (zero the cumulative base), not `playing`.
  playedClockRef: MutableRefObject<{
    start: (now: number, reset?: boolean) => void;
    stop: (now: number, reset?: boolean) => void;
    pause: (now: number) => void;
    resume: (now: number) => void;
    reset: () => void;
    /** Move the clock to an absolute position; used by seek. */
    hydrate: (baseMs: number, startedAt: number | null) => void;
    current: (now: number) => number;
  }>;
  trackStartedAtRef: MutableRefObject<number | null>;
  soundingTuneRef: MutableRefObject<PlaylistItem | null>;
  soundingTune: PlaylistItem | null;
  setSoundingTune: (tune: PlaylistItem | null) => void;
  trackInstanceIdRef: MutableRefObject<number>;
  autoAdvanceGuardRef: MutableRefObject<AutoAdvanceGuard | null>;
  playStartInFlightRef: MutableRefObject<boolean>;

  cancelAutoAdvance: () => void;
  enqueuePlayTransition: (task: () => Promise<void>) => Promise<void>;
  durationSeconds: number; // for fallback

  setAutoAdvanceDueAtMs: (dueAtMs: number | null) => void;

  trace: any;

  /**
   * Local SID playback engine (Track B / LE2). Injected in tests; created
   * lazily in production. Playback routes here for SID items only when
   * `c64u_local_engine_enabled` is on and the engine is set to `local`.
   */
  localSidPlaybackController?: LocalSidPlaybackController;
}
