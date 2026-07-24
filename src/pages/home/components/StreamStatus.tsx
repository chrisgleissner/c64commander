/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { motion } from "framer-motion";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSharedConfigActions } from "../hooks/ConfigActionsContext";
import { useStreamData } from "../hooks/useStreamData";
import { buildConfigKey } from "@/pages/home/utils/HomeConfigUtils";
import { buildStreamEndpointLabel } from "@/lib/config/homeStreams";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useAvMirror } from "@/hooks/useAvMirror";

interface StreamStatusProps {
  isConnected: boolean;
}

export function StreamStatus({ isConnected }: StreamStatusProps) {
  const { profile } = useDisplayProfile();
  const { configWritePending, updateConfigValue } = useSharedConfigActions();
  // Live View shares the device's VIC/Audio feeds. While it is receiving one, it takes
  // precedence: that Streams row is shown read-only with an explanation, and the user's
  // configured target resumes control the moment Live View stops.
  const { videoLive, audioLive } = useAvMirror();
  const isLiveViewFeed = (key: string) => (key === "vic" && videoLive) || (key === "audio" && audioLive);

  const {
    streamControlEntries,
    streamDrafts,
    activeStreamEditorKey,
    streamEditorError,
    streamActionPending,
    handleStreamStart,
    handleStreamStop,
    handleStreamFieldChange,
    handleStreamEditOpen,
    handleStreamEditCancel,
    handleStreamCommit,
  } = useStreamData(isConnected, configWritePending, updateConfigValue);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.38 }}
      className="space-y-2"
      data-testid="home-stream-status"
      data-section-label="Streams"
    >
      <SectionHeader title="Streams" />
      <div className="space-y-2">
        {streamControlEntries.map((entry) => {
          const draft = streamDrafts[entry.key] ?? {
            ip: entry.ip,
            port: entry.port,
            endpoint: buildStreamEndpointLabel(entry.ip, entry.port),
          };
          const pending =
            Boolean(configWritePending[buildConfigKey("Data Streams", entry.itemName)]) ||
            Boolean(streamActionPending[entry.key]);
          const liveViewControlled = isLiveViewFeed(entry.key);
          const locked = !isConnected || pending || liveViewControlled;
          return (
            <div
              key={entry.key}
              className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
              data-testid={`home-stream-row-${entry.key}`}
              data-live-view-controlled={liveViewControlled ? "true" : undefined}
            >
              <div
                className="flex items-center justify-between gap-2 text-xs"
                aria-label={`${entry.label.toUpperCase()} stream ${draft.ip}:${draft.port}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left flex items-center gap-2"
                  onClick={() => handleStreamEditOpen(entry.key)}
                  disabled={locked}
                  data-testid={`home-stream-edit-toggle-${entry.key}`}
                  aria-label={`Edit ${entry.label} stream target`}
                >
                  <span className="font-semibold text-foreground w-12 shrink-0 whitespace-nowrap">
                    {profile === "compact"
                      ? (({ vic: "VIC", audio: "AUD", debug: "DBG" } as Record<string, string>)[entry.key] ??
                        entry.label.slice(0, 3).toUpperCase())
                      : entry.label.toUpperCase()}
                  </span>
                  <span
                    className="font-semibold text-foreground truncate"
                    data-testid={`home-stream-endpoint-display-${entry.key}`}
                  >
                    {buildStreamEndpointLabel(draft.ip, draft.port)}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  {liveViewControlled ? (
                    <span
                      className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary"
                      data-testid={`home-stream-liveview-badge-${entry.key}`}
                    >
                      Live View
                    </span>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStreamStart(entry.key)}
                        disabled={locked}
                        data-testid={`home-stream-start-${entry.key}`}
                        className="h-6 px-2 text-xs"
                      >
                        Start
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStreamStop(entry.key)}
                        disabled={locked}
                        data-testid={`home-stream-stop-${entry.key}`}
                        className="h-6 px-2 text-xs"
                      >
                        Stop
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {liveViewControlled && (
                <p
                  className="mt-1.5 text-[11px] text-muted-foreground"
                  data-testid={`home-stream-liveview-note-${entry.key}`}
                >
                  Live View is receiving this stream into the app. Your configured target resumes when you stop Live
                  View.
                </p>
              )}
              {!liveViewControlled && activeStreamEditorKey === entry.key && (
                <div className="mt-2 rounded-md border border-border/60 bg-background p-2.5">
                  <div
                    className={
                      profile === "expanded"
                        ? "grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2 text-[11px]"
                        : "grid grid-cols-1 gap-2 text-[11px]"
                    }
                  >
                    <div className="space-y-1">
                      <label htmlFor={`home-stream-endpoint-${entry.key}`} className="text-muted-foreground">
                        IP:PORT
                      </label>
                      <Input
                        id={`home-stream-endpoint-${entry.key}`}
                        value={draft.endpoint}
                        onChange={(event) => handleStreamFieldChange(entry.key, event.target.value)}
                        disabled={!isConnected || pending}
                        data-testid={`home-stream-endpoint-${entry.key}`}
                        aria-label={`${entry.label} stream endpoint`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleStreamEditCancel(entry.key)}
                      disabled={!isConnected || pending}
                      data-testid={`home-stream-cancel-${entry.key}`}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleStreamCommit(entry.key)}
                      disabled={!isConnected || pending}
                      data-testid={`home-stream-confirm-${entry.key}`}
                    >
                      OK
                    </Button>
                  </div>
                  {streamEditorError && (
                    <p className="mt-2 text-[11px] text-destructive" data-testid={`home-stream-error-${entry.key}`}>
                      {streamEditorError}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
