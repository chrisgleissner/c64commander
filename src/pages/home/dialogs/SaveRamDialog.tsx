/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { MemoryRange, SnapshotType } from "@/lib/snapshot/snapshotTypes";
import { SNAPSHOT_TYPE_LIST } from "@/lib/snapshot/snapshotTypes";
import {
  EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT,
  sanitizeHexAddressInput,
  validateCustomSnapshotRanges,
  type CustomSnapshotRangeDraft,
} from "@/lib/snapshot/customSnapshotRanges";
import { loadCustomSnapshotDrafts, saveCustomSnapshotDrafts } from "@/lib/snapshot/customSnapshotDraftStore";

interface SaveRamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (type: SnapshotType, customRanges?: MemoryRange[]) => void;
  onSaveReu?: () => void;
  isSaving: boolean;
  telnetAvailable?: boolean;
  telnetBusy?: boolean;
}

const buildRangeTestId = (base: string, index: number) => (index === 0 ? base : `${base}-${index}`);

function HexAddressInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
        $
      </span>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(sanitizeHexAddressInput(e.target.value))}
        data-testid={testId}
        className="pl-7 font-mono uppercase"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={4}
      />
    </div>
  );
}

export function SaveRamDialog({
  open,
  onOpenChange,
  onSave,
  onSaveReu,
  isSaving,
  telnetAvailable = false,
  telnetBusy = false,
}: SaveRamDialogProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customRanges, setCustomRanges] = useState<CustomSnapshotRangeDraft[]>(() => loadCustomSnapshotDrafts());
  const showSaveReu = telnetAvailable && typeof onSaveReu === "function";

  useEffect(() => {
    saveCustomSnapshotDrafts(customRanges);
  }, [customRanges]);

  const handleClose = () => {
    setShowCustom(false);
    onOpenChange(false);
  };

  const updateRange = (index: number, field: keyof CustomSnapshotRangeDraft, value: string) => {
    setCustomRanges((current) =>
      current.map((range, rangeIndex) =>
        rangeIndex === index
          ? {
              ...range,
              [field]: sanitizeHexAddressInput(value),
            }
          : range,
      ),
    );
  };

  const addRange = () => {
    setCustomRanges((current) => [...current, { ...EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT }]);
  };

  const deleteRange = (index: number) => {
    setCustomRanges((current) => {
      const next = current.filter((_, rangeIndex) => rangeIndex !== index);
      return next.length > 0 ? next : [{ ...EMPTY_CUSTOM_SNAPSHOT_RANGE_DRAFT }];
    });
  };

  const handleTypeSelect = (type: SnapshotType) => {
    if (type === "custom") {
      setShowCustom(true);
      return;
    }
    onSave(type);
    handleClose();
  };

  const handleCustomSave = () => {
    const validation = validateCustomSnapshotRanges(customRanges);
    if (!validation.ok) {
      toast({ title: validation.title, description: validation.description });
      return;
    }
    onSave("custom", validation.ranges);
    handleClose();
  };

  return (
    <AppDialog open={open} onOpenChange={handleClose}>
      <AppDialogContent data-testid="save-ram-dialog">
        <AppDialogHeader>
          <AppDialogTitle>Save RAM</AppDialogTitle>
          <AppDialogDescription>
            Choose the memory region to snapshot.
            {showCustom && " Enter one or more hex ranges."}
          </AppDialogDescription>
        </AppDialogHeader>

        <AppDialogBody>
          {!showCustom ? (
            <div className="space-y-2" data-testid="save-ram-type-list">
              {SNAPSHOT_TYPE_LIST.map((config) => (
                <button
                  key={config.type}
                  data-testid={`save-ram-type-${config.type}`}
                  className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent hover:text-accent-foreground px-4 py-3 transition-colors disabled:opacity-50"
                  onClick={() => void handleTypeSelect(config.type)}
                  disabled={isSaving}
                >
                  <div className="font-semibold text-sm">{config.label}</div>
                  {config.type !== "custom" && (
                    <div className="text-xs text-muted-foreground mt-0.5">{config.rangeDisplay}</div>
                  )}
                </button>
              ))}
              {showSaveReu && (
                <button
                  data-testid="save-ram-type-reu"
                  className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent hover:text-accent-foreground px-4 py-3 transition-colors disabled:opacity-50"
                  onClick={() => {
                    onSaveReu();
                    handleClose();
                  }}
                  disabled={isSaving || telnetBusy}
                >
                  <div className="font-semibold text-sm">Save REU</div>
                  <div className="text-xs text-muted-foreground mt-0.5">REU expansion memory</div>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3" data-testid="save-ram-custom-form">
              <div className="space-y-2">
                {customRanges.map((range, index) => (
                  <div key={`custom-range-${index}`} className="flex items-center gap-2">
                    <HexAddressInput
                      placeholder="Start"
                      value={range.start}
                      onChange={(value) => updateRange(index, "start", value)}
                      testId={buildRangeTestId("save-ram-custom-start", index)}
                    />
                    <span className="text-muted-foreground">–</span>
                    <HexAddressInput
                      placeholder="End"
                      value={range.end}
                      onChange={(value) => updateRange(index, "end", value)}
                      testId={buildRangeTestId("save-ram-custom-end", index)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => deleteRange(index)}
                      aria-label={`Delete range ${index + 1}`}
                      data-testid={`save-ram-custom-delete-range-${index}`}
                      disabled={isSaving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={addRange}
                disabled={isSaving}
                data-testid="save-ram-custom-add-range"
              >
                Add Range
              </Button>
            </div>
          )}
        </AppDialogBody>

        <AppDialogFooter>
          {showCustom ? (
            <>
              <Button variant="outline" onClick={() => setShowCustom(false)} disabled={isSaving}>
                Back
              </Button>
              <Button onClick={handleCustomSave} disabled={isSaving} data-testid="save-ram-custom-confirm">
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
          )}
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  );
}
