/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { PlaybackConfigOverrideEditor } from "@/pages/playFiles/components/PlaybackConfigOverrideEditor";
import type { ConfigCandidate } from "@/lib/config/playbackConfig";
import {
  describeConfigOrigin,
  resolvePlaybackConfigUiState,
  summarizeConfigChangeCategories,
} from "@/lib/config/playbackConfig";
import type { PlaylistItem } from "@/pages/playFiles/types";

type PlaybackConfigSheetProps = {
  item: PlaylistItem | null;
  open: boolean;
  canRediscover: boolean;
  onOpenChange: (open: boolean) => void;
  onAttachLocalConfig: (item: PlaylistItem) => void;
  onAttachUltimateConfig: (item: PlaylistItem) => void;
  onChooseCandidate: (item: PlaylistItem, candidate: ConfigCandidate) => void;
  onRemoveConfig: (item: PlaylistItem) => void;
  onRediscover: (item: PlaylistItem) => void;
  onUpdateOverrides: (item: PlaylistItem, overrides: PlaylistItem["configOverrides"]) => void;
};

const strategyLabel: Record<ConfigCandidate["strategy"], string> = {
  "exact-name": "Same name",
  directory: "Same folder",
  "parent-directory": "Parent folder",
};

const stateLabel: Record<ReturnType<typeof resolvePlaybackConfigUiState>, string> = {
  none: "No config",
  candidates: "Candidates found",
  resolved: "Config resolved",
  edited: "Config edited",
  declined: "Config declined",
};

export const PlaybackConfigSheet = ({
  item,
  open,
  canRediscover,
  onOpenChange,
  onAttachLocalConfig,
  onAttachUltimateConfig,
  onChooseCandidate,
  onRemoveConfig,
  onRediscover,
  onUpdateOverrides,
}: PlaybackConfigSheetProps) => {
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditorOpen(false);
    }
  }, [open]);

  const uiState = item
    ? resolvePlaybackConfigUiState({
        configRef: item.configRef ?? null,
        configOrigin: item.configOrigin ?? "none",
        configOverrides: item.configOverrides ?? null,
        configCandidates: item.configCandidates ?? null,
      })
    : "none";
  const changeCategories = summarizeConfigChangeCategories(item?.configOverrides ?? null);

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent>
        <AppSheetHeader>
          <AppSheetTitle>Playback config</AppSheetTitle>
          <AppSheetDescription>
            {item ? `Review and change the playback config for ${item.label}.` : "Review the playback config state."}
          </AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="space-y-4 px-4 py-4 sm:px-6">
          {item ? (
            <>
              <section className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                <div className="text-sm font-medium text-foreground">Current state</div>
                <dl className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-start justify-between gap-3">
                    <dt>Status</dt>
                    <dd className="text-right text-foreground">{stateLabel[uiState]}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>Origin</dt>
                    <dd className="text-right text-foreground">{describeConfigOrigin(item.configOrigin ?? "none")}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>Resolved file</dt>
                    <dd className="text-right text-foreground">
                      {item.configRef ? (
                        <span className="inline-flex items-center gap-2">
                          <FileOriginIcon
                            origin={item.configRef.kind === "local" ? "local" : "ultimate"}
                            className="h-3.5 w-3.5"
                          />
                          {item.configRef.fileName}
                        </span>
                      ) : (
                        "None"
                      )}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>Candidates</dt>
                    <dd className="text-right text-foreground">{item.configCandidates?.length ?? 0}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt>Overrides</dt>
                    <dd className="text-right text-foreground">{item.configOverrides?.length ?? 0}</dd>
                  </div>
                  {changeCategories.length ? (
                    <div className="flex items-start justify-between gap-3">
                      <dt>Override categories</dt>
                      <dd className="text-right text-foreground">{changeCategories.join(", ")}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {item.configCandidates?.length ? (
                <section className="space-y-3 rounded-lg border border-border bg-card/60 p-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Discovered candidates</div>
                    <div className="text-xs text-muted-foreground">
                      Choose one to make it the manual playback config for this playlist item.
                    </div>
                  </div>
                  <div className="space-y-2">
                    {item.configCandidates.map((candidate) => {
                      const isResolved = item.configRef && item.configRef.fileName === candidate.ref.fileName;
                      return (
                        <div
                          key={`${candidate.ref.fileName}:${candidate.strategy}:${candidate.distance}`}
                          className="rounded-md border border-border px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{candidate.ref.fileName}</div>
                              <div className="text-xs text-muted-foreground">
                                {strategyLabel[candidate.strategy]} · {candidate.confidence} confidence
                                {candidate.distance > 0
                                  ? ` · ${candidate.distance} level${candidate.distance === 1 ? "" : "s"} up`
                                  : ""}
                              </div>
                            </div>
                            <Button
                              variant={isResolved ? "secondary" : "outline"}
                              size="sm"
                              onClick={() => onChooseCandidate(item, candidate)}
                            >
                              {isResolved ? "Selected" : "Use"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                <div className="text-sm font-medium text-foreground">Actions</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => onAttachLocalConfig(item)}>
                    Select local .cfg
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onAttachUltimateConfig(item)}>
                    Select C64U .cfg
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditorOpen((current) => !current)}>
                    {editorOpen ? "Hide value edits" : "Edit values"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onRemoveConfig(item)}>
                    No config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onRediscover(item)} disabled={!canRediscover}>
                    Re-discover
                  </Button>
                </div>
                {!canRediscover ? (
                  <div className="text-xs text-muted-foreground">
                    Re-discovery is available for local files and C64U files.
                  </div>
                ) : null}
              </section>

              {editorOpen ? <PlaybackConfigOverrideEditor item={item} onChangeOverrides={onUpdateOverrides} /> : null}
            </>
          ) : null}
        </AppSheetBody>
        <AppSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </AppSheetFooter>
      </AppSheetContent>
    </AppSheet>
  );
};
