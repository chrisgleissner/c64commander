/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";

interface ConfigItem {
  id: string;
  name: string;
  savedAt: string;
}

interface LoadConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configs: ConfigItem[];
  onLoad: (id: string) => void;
  applyingConfigId: string | null;
}

export function LoadConfigDialog({ open, onOpenChange, configs, onLoad, applyingConfigId }: LoadConfigDialogProps) {
  const isApplying = applyingConfigId !== null;

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent className="overflow-hidden p-0" data-testid="load-config-sheet">
        <AppSheetHeader className="px-4 pb-[0.5625rem] pt-3 pr-14 sm:px-6 sm:pb-[0.75rem] sm:pt-[0.9375rem]">
          <AppSheetTitle>Load from App</AppSheetTitle>
          <AppSheetDescription>Select a saved configuration to apply to the C64U.</AppSheetDescription>
        </AppSheetHeader>
        <AppSheetBody className="px-4 py-4 sm:px-6">
          <div className="space-y-2">
            {configs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
            ) : (
              configs.map((config) => (
                <Button
                  key={config.id}
                  variant="outline"
                  className="h-auto w-full justify-between py-3 text-left"
                  onClick={() => onLoad(config.id)}
                  disabled={isApplying}
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="font-medium">{config.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {new Date(config.savedAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {applyingConfigId === config.id ? "Applying…" : "Load"}
                  </span>
                </Button>
              ))
            )}
          </div>
        </AppSheetBody>
        <AppSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </AppSheetFooter>
      </AppSheetContent>
    </AppSheet>
  );
}
