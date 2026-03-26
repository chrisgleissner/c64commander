/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildArchiveQuery } from "@/lib/archive/queryBuilder";
import { ARCHIVE_BACKEND_DEFAULTS } from "@/lib/archive/config";
import type {
  ArchiveBackend,
  ArchivePreset,
  ArchivePresetType,
  ArchiveSearchParams,
  ArchiveSearchResult,
} from "@/lib/archive/types";
import { useOnlineArchive } from "@/hooks/useOnlineArchive";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { reportUserError } from "@/lib/uiErrors";

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

const TEXT_FIELDS: Array<{
  key: keyof ArchiveSearchParams;
  label: string;
  placeholder: string;
}> = [
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

export type ArchiveSelectedItem = {
  result: ArchiveSearchResult;
};

export type ArchiveSelectionViewProps = {
  config: ArchiveClientConfigInput;
  backend: ArchiveBackend;
  selection: Map<string, ArchiveSearchResult>;
  onToggleSelect: (result: ArchiveSearchResult) => void;
  onSelectAll: (results: ArchiveSearchResult[]) => void;
  onClearSelection: () => void;
};

const getPresetMap = (presets: ArchivePreset[]) => new Map(presets.map((preset) => [preset.type, preset]));

const resultKey = (result: ArchiveSearchResult) => `${result.id}:${result.category}`;

export const ArchiveSelectionView = ({
  config,
  backend,
  selection,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
}: ArchiveSelectionViewProps) => {
  const [form, setForm] = useState<ArchiveSearchParams>(EMPTY_SEARCH);
  const { presets, presetsLoading, resolvedConfig, state, clearError, search } = useOnlineArchive(config);
  const presetMap = useMemo(() => getPresetMap(presets), [presets]);

  useEffect(() => {
    if (state.phase === "error") {
      reportUserError({
        operation: "ONLINE_ARCHIVE",
        title: "Online archive failed",
        description: state.message,
      });
      clearError();
    }
  }, [clearError, state]);

  const queryPreview = useMemo(() => {
    try {
      return buildArchiveQuery(form);
    } catch {
      return "";
    }
  }, [form]);

  const resultRows = "results" in state ? state.results : [];

  const handleSearch = useCallback(async () => {
    await search(form);
  }, [form, search]);

  const currentDefaults = ARCHIVE_BACKEND_DEFAULTS[resolvedConfig.backend];
  const backendLabel = backend === "commodore" ? "CommoServe" : "Assembly64";

  return (
    <div className="space-y-3" data-testid="archive-selection-view">
      <div
        className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground"
        data-testid="archive-selection-config"
      >
        <div>
          Backend: <span className="font-medium text-foreground">{backendLabel}</span>
        </div>
        <div>
          Host: <span className="font-medium text-foreground break-all">{resolvedConfig.host}</span>
        </div>
        {resolvedConfig.host !== currentDefaults.host ? <p className="mt-1">Override host active.</p> : null}
      </div>

      <div className="grid gap-2">
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={`archive-sel-${field.key}`} className="text-xs font-medium">
              {field.label}
            </Label>
            <Input
              id={`archive-sel-${field.key}`}
              value={form[field.key] ?? ""}
              placeholder={field.placeholder}
              className="h-8 text-sm"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
            />
          </div>
        ))}

        {SELECT_FIELDS.map((field) => {
          const preset = presetMap.get(field.key);
          return (
            <div key={field.key} className="space-y-1">
              <Label className="text-xs font-medium">{field.label}</Label>
              <Select
                value={form[field.key] || "__any__"}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    [field.key]: value === "__any__" ? "" : value,
                  }))
                }
                disabled={presetsLoading || !preset}
              >
                <SelectTrigger className="h-8 text-sm">
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

      <div className="flex gap-2">
        <Button
          className="flex-1"
          size="sm"
          onClick={() => void handleSearch()}
          disabled={!queryPreview || presetsLoading || state.phase === "searching"}
          data-testid="archive-search-button"
        >
          {state.phase === "searching" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          Search
        </Button>
      </div>

      {queryPreview ? (
        <p className="text-[11px] text-muted-foreground" data-testid="archive-query-preview">
          {queryPreview}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Enter at least one search term.</p>
      )}

      {resultRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onSelectAll(resultRows)} data-testid="archive-select-all">
            Select all ({resultRows.length})
          </Button>
          {selection.size > 0 ? (
            <Button variant="outline" size="sm" onClick={onClearSelection} data-testid="archive-clear-selection">
              Clear selection
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2" data-testid="archive-selection-results">
        {state.phase !== "searching" && resultRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {state.phase === "idle" ? "Search results appear here." : "No results found."}
          </p>
        ) : null}
        {resultRows.map((result) => {
          const key = resultKey(result);
          const isSelected = selection.has(key);
          return (
            <div
              key={key}
              className="flex items-center gap-2 min-w-0 border-b border-border/50 py-2"
              data-testid="archive-result-row"
            >
              <div className="shrink-0">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(result)}
                  aria-label={`Select ${result.name}`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <p className="text-sm font-medium break-words whitespace-normal">{result.name}</p>
                <p className="text-xs text-muted-foreground break-words">
                  {result.group ?? "Unknown group"} • {result.year || "Unknown year"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { resultKey as archiveResultKey };
