/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Check, Loader2, Monitor } from "lucide-react";

import type { VicPalette } from "@/generated/vicPalettes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { PaletteSwatchStrip } from "@/components/palette/PaletteSwatchStrip";
import { Label } from "@/components/ui/label";
import { addLog } from "@/lib/logging";
import type { PaletteTarget } from "@/lib/config/appSettings";
import { useScreenColors } from "@/hooks/useScreenColors";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/**
 * Choosing the colors a C64 picture is drawn in, and choosing where that lands.
 *
 * A list rather than a dropdown, for two reasons. Sixteen swatches say more than a name does and
 * need a row to themselves. And palettes already installed on the machine arrive as filenames of up
 * to thirty characters — the firmware's own limit — which a select trigger would truncate and a
 * list row does not, because the row has the full width and wraps.
 */

const TARGET_LABELS: Record<PaletteTarget, string> = {
  local: "Local",
  remote: "Remote",
  both: "Both",
};

function TargetToggle({ value, onChange }: { value: PaletteTarget; onChange: (next: PaletteTarget) => void }) {
  const option = (target: PaletteTarget, icon: React.ReactNode, testId: string) => {
    const active = value === target;
    return (
      <Button
        key={target}
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        data-testid={testId}
        aria-pressed={active}
        onClick={() => onChange(target)}
        className="gap-1.5"
      >
        {icon}
        {TARGET_LABELS[target]}
      </Button>
    );
  };

  return (
    // Label above, buttons in a wrapping row — the same shape as "Listen on" for a tune, because it
    // is the same question about a different sense. Local, Remote, Both reads as a progression from
    // this device outwards.
    <div role="group" aria-label="Show on" data-testid="screen-colors-target" className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">Show on</Label>
      <div className="flex flex-wrap gap-2">
        {option("local", <FileOriginIcon origin="local" className="h-3.5 w-3.5" label="" />, "screen-colors-local")}
        {option(
          "remote",
          <FileOriginIcon origin="ultimate" className="h-3.5 w-3.5" label="" />,
          "screen-colors-remote",
        )}
        {option("both", <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />, "screen-colors-both")}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="screen-colors-target-hint">
        {value === "local"
          ? "Changes the picture in Live View on this device only. The C64 is not touched."
          : value === "remote"
            ? "Changes what the C64 itself draws, so the television changes too."
            : "Changes both this device's Live View and what the C64 itself draws."}
      </p>
    </div>
  );
}

function PaletteRow({
  palette,
  selected,
  onDevice,
  busy,
  onSelect,
  testId,
}: {
  palette: VicPalette;
  selected: boolean;
  onDevice: boolean;
  busy: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left",
        selected ? "border-primary bg-primary/5" : "border-border/70",
      )}
    >
      <div className="flex items-start gap-2">
        {/* The name wraps rather than truncating. A palette installed on the machine can be thirty
            characters of filename, and a name the user cannot read is a name they cannot choose by. */}
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{palette.name}</span>
        {/* Which palette the MACHINE is on, which is not the same question as which one is selected
            here. With the Remote target the selection does not move, so without this the list would
            say nothing about where the palette landed. */}
        {onDevice ? (
          <span
            className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[0.65rem] text-muted-foreground"
            data-testid={`${testId}-on-device`}
          >
            On the C64
          </span>
        ) : null}
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        {selected && !busy ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
      </div>
      {palette.description ? <span className="text-xs text-muted-foreground">{palette.description}</span> : null}
      <PaletteSwatchStrip palette={palette} height="h-5" testId={`${testId}-strip`} />
    </button>
  );
}

export function ScreenColorsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    apply,
    applying,
    builtInPalettes,
    devicePalettes,
    devicePalettesLoading,
    following,
    followDevice,
    isOnDevice,
    selectedId,
    setTarget,
    target,
  } = useScreenColors({ enabled: open });

  const choose = (palette: VicPalette) => {
    void apply(palette)
      .then(() => {
        if (target !== "local") toast({ title: `${palette.name} applied to the C64` });
      })
      .catch((error) => {
        addLog("warn", "Could not change the C64's palette", {
          palette: palette.id,
          message: (error as Error).message,
        });
        toast({
          title: "Could not change the C64's colors",
          description: (error as Error).message,
          variant: "destructive",
        });
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeTestId="screen-colors-close" surface="list-browser">
        <DialogHeader>
          <DialogTitle>Screen colors</DialogTitle>
          <DialogDescription>
            The C64 sends color numbers rather than colors, so a palette decides what those numbers look like. Choose
            one below.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(30rem,65vh)] space-y-3 overflow-y-auto px-4 py-3">
          <TargetToggle value={target} onChange={setTarget} />

          <button
            type="button"
            onClick={followDevice}
            aria-pressed={following}
            data-testid="screen-colors-follow-device"
            className={cn(
              "flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left",
              following ? "border-primary bg-primary/5" : "border-border/70",
            )}
          >
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">Follow the C64</span>
              {following ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
            </div>
            <span className="text-xs text-muted-foreground">
              Live View uses whatever palette this C64 is set to, so the phone and the television match.
            </span>
          </button>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Palettes</p>
            {builtInPalettes.map((palette) => (
              <PaletteRow
                key={palette.id}
                palette={palette}
                selected={!following && selectedId === palette.id}
                onDevice={isOnDevice(palette)}
                busy={applying === palette.id}
                onSelect={() => choose(palette)}
                testId={`screen-colors-palette-${palette.id}`}
              />
            ))}
          </div>

          {devicePalettesLoading || devicePalettes.length > 0 ? (
            <div className="space-y-2" data-testid="screen-colors-device-palettes">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Already on this C64
              </p>
              {devicePalettesLoading ? (
                <p className="text-xs text-muted-foreground">Reading…</p>
              ) : (
                devicePalettes.map((palette) => (
                  <PaletteRow
                    key={palette.id}
                    palette={palette}
                    selected={!following && selectedId === palette.id}
                    onDevice={isOnDevice(palette)}
                    busy={applying === palette.id}
                    onSelect={() => choose(palette)}
                    testId={`screen-colors-palette-${palette.id}`}
                  />
                ))
              )}
            </div>
          ) : null}

          {target === "local" ? null : (
            <p className="text-xs text-muted-foreground" data-testid="screen-colors-install-note">
              Sending a palette to the C64 copies a small file (under 1 KB) to its flash storage and changes the picture
              straight away. Whether it is still there after a power cycle depends on{" "}
              <strong>Keep device settings after a restart</strong> in Settings.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
