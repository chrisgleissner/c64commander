/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportUserError } from "@/lib/uiErrors";
import { getArchiveEntryActionLabel } from "@/lib/archive/execution";
import { buildArchiveQuery } from "@/lib/archive/queryBuilder";
import { DEFAULT_ARCHIVE_SOURCE_CONFIG, resolveArchiveClientConfig } from "@/lib/archive/config";
import type {
  ArchiveClientConfigInput,
  ArchivePreset,
  ArchivePresetType,
  ArchiveSearchParams,
} from "@/lib/archive/types";
import { useOnlineArchive } from "@/hooks/useOnlineArchive";

const EMPTY_SEARCH: ArchiveSearchParams = {
  name: "",
  group: "",
  handle: "",
  event: "",
  category: "",
  date: "",
  type: "",
  sort: "",
  order: "",
};

const TEXT_FIELDS: Array<{ key: keyof ArchiveSearchParams; label: string; placeholder: string }> = [
  { key: "name", label: "Name", placeholder: "Search title" },
  { key: "group", label: "Group", placeholder: "Publisher or group" },
  { key: "handle", label: "Handle", placeholder: "Author handle" },
  { key: "event", label: "Event", placeholder: "Party / event" },
];

const SELECT_FIELDS: Array<{ key: ArchivePresetType; label: string }> = [
  { key: "category", label: "Category" },
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "sort", label: "Sort by" },
  { key: "order", label: "Order" },
];

const formatEntryMeta = (size?: number, date?: number) => {
  const parts: string[] = [];
  if (typeof size === "number") {
    parts.push(`${size.toLocaleString()} bytes`);
  }
  if (typeof date === "number") {
    parts.push(new Date(date).toLocaleDateString());
  }
  return parts.join(" • ");
};

const getPresetMap = (presets: ArchivePreset[]) => new Map(presets.map((preset) => [preset.type, preset]));

export type OnlineArchiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ArchiveClientConfigInput;
};

export const OnlineArchiveDialog = ({ open, onOpenChange, config }: OnlineArchiveDialogProps) => {
  const [form, setForm] = useState<ArchiveSearchParams>(EMPTY_SEARCH);
  const { clientType, presets, presetsLoading, resolvedConfig, state, clearError, search, openEntries, execute } =
    useOnlineArchive(config);
  const presetMap = useMemo(() => getPresetMap(presets), [presets]);

  useEffect(() => {
    if (!open && state.phase === "error") {
      clearError();
    }
  }, [clearError, open, state.phase]);

  useEffect(() => {
    if (!open || state.phase !== "error") return;
    reportUserError({
      operation: "ONLINE_ARCHIVE",
      title: "Online archive failed",
      description: state.message,
    });
  }, [open, state]);

  const queryPreview = useMemo(() => {
    try {
      return buildArchiveQuery(form);
    } catch {
      return "";
    }
  }, [form]);

  const currentDefaults = resolveArchiveClientConfig(DEFAULT_ARCHIVE_SOURCE_CONFIG);

  const resultRows = "results" in state ? state.results : [];
  const entryRows = "entries" in state ? state.entries : [];
  const selectedResult = "result" in state ? state.result : null;
  const activeEntryId = "entry" in state ? state.entry.id : null;
  const entriesLoading = state.phase === "loadingEntries";

  const handleSearch = async () => {
    await search(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl" data-testid="online-archive-dialog">
        <DialogHeader>
          <DialogTitle>Online Archive</DialogTitle>
          <DialogDescription>
            Search {resolvedConfig.name} via direct HTTP and execute files via device REST.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="space-y-4 overflow-y-auto pr-1">
            <div
              className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground"
              data-testid="online-archive-config-summary"
            >
              <div>
                Source: <span className="font-medium text-foreground">{resolvedConfig.name}</span>
              </div>
              <div>
                Client: <span className="font-medium text-foreground">{clientType}</span>
              </div>
              <div>
                Host: <span className="font-medium text-foreground break-all">{resolvedConfig.host}</span>
              </div>
              <div>
                Client-Id: <span className="font-medium text-foreground">{resolvedConfig.clientId}</span>
              </div>
              <div>
                User-Agent: <span className="font-medium text-foreground">{resolvedConfig.userAgent}</span>
              </div>
              {resolvedConfig.host !== currentDefaults.host ||
              resolvedConfig.clientId !== currentDefaults.clientId ||
              resolvedConfig.userAgent !== currentDefaults.userAgent ? (
                <p className="mt-2">
                  Overrides are active. Native platform security may block non-default cleartext hosts.
                </p>
              ) : null}
            </div>

            <div className="grid gap-3">
              {TEXT_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`archive-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`archive-${field.key}`}
                    value={form[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </div>
              ))}

              {SELECT_FIELDS.map((field) => {
                const preset = presetMap.get(field.key);
                return (
                  <div key={field.key} className="space-y-2">
                    <Label>{field.label}</Label>
                    <Select
                      value={form[field.key] || "__any__"}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, [field.key]: value === "__any__" ? "" : value }))
                      }
                      disabled={presetsLoading || !preset}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={presetsLoading ? "Loading…" : "Any"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Any</SelectItem>
                        {(preset?.values ?? []).map((value) => (
                          <SelectItem key={value.aqlKey} value={value.aqlKey}>
                            {value.name ?? value.aqlKey}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 p-3">
              <div className="text-xs text-muted-foreground">
                {queryPreview ? (
                  <span data-testid="online-archive-query-preview">{queryPreview}</span>
                ) : (
                  "Enter at least one search term."
                )}
              </div>
              <Button
                className="w-full"
                onClick={() => void handleSearch()}
                disabled={!queryPreview || presetsLoading || state.phase === "searching"}
              >
                {state.phase === "searching" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search archive
              </Button>
            </div>
          </div>

          <div className="space-y-3 overflow-y-auto pr-1">
            {selectedResult ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">{selectedResult.name}</p>
                  <p className="text-xs text-muted-foreground break-words">
                    {selectedResult.group ?? "Unknown group"} • {selectedResult.updated ?? "No date"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void search(
                      state.phase === "entries" || state.phase === "downloading" || state.phase === "executing"
                        ? state.params
                        : form,
                    )
                  }
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Results
                </Button>
              </div>
            ) : null}

            {!selectedResult ? (
              <div className="space-y-2" data-testid="online-archive-results">
                {!resultRows.length ? (
                  <p className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                    Search results appear here.
                  </p>
                ) : null}
                {resultRows.map((result) => (
                  <button
                    key={`${result.id}:${result.category}`}
                    type="button"
                    className="w-full rounded-lg border border-border p-3 text-left hover:border-primary/50"
                    onClick={() =>
                      void openEntries(state.phase === "results" ? state.params : form, result, resultRows)
                    }
                  >
                    <p className="font-medium break-words">{result.name}</p>
                    <p className="text-xs text-muted-foreground break-words">
                      {result.group ?? "Unknown group"} • {result.year || "Unknown year"} •{" "}
                      {result.updated ?? "No update date"}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2" data-testid="online-archive-entries">
                {entriesLoading ? (
                  <div className="rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading entries…
                  </div>
                ) : null}
                {!entriesLoading && !entryRows.length ? (
                  <p className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                    No executable files found for this result.
                  </p>
                ) : null}
                {entryRows.map((entry) => {
                  const busy = activeEntryId === entry.id;
                  return (
                    <div key={entry.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{entry.path}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatEntryMeta(entry.size, entry.date) || "No metadata"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            void execute(
                              state.phase === "entries" || state.phase === "downloading" || state.phase === "executing"
                                ? state.params
                                : form,
                              selectedResult,
                              resultRows,
                              entry,
                              entryRows,
                            )
                          }
                          disabled={state.phase === "downloading" || state.phase === "executing"}
                        >
                          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {busy && state.phase === "downloading"
                            ? "Downloading…"
                            : busy && state.phase === "executing"
                              ? "Executing…"
                              : getArchiveEntryActionLabel(entry.path)}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
