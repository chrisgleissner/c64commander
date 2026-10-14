/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface RemoteInputControlsMenuItem {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
}

export interface RemoteInputControlsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly RemoteInputControlsMenuItem[];
  /** Where focus goes once the menu has closed; the menu restores nothing itself. */
  onClosed: () => void;
}

/**
 * The Remote Input sheet's controls, for the keypad. While the keypad drives the C64, the sheet's
 * own buttons are out of the focus ring's reach, so the right soft key opens this list instead.
 */
export const RemoteInputControlsMenu = ({ open, onOpenChange, items, onClosed }: RemoteInputControlsMenuProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="flex max-h-[85dvh] max-w-xs flex-col overflow-hidden"
      data-testid="remote-input-controls-menu"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed();
      }}
    >
      <DialogHeader>
        <DialogTitle>Remote Input</DialogTitle>
        <DialogDescription>Choose what the keypad does.</DialogDescription>
      </DialogHeader>
      <div className="-mx-1 grid min-h-0 flex-1 gap-1.5 overflow-y-auto px-1">
        {items.map((item) => (
          <Button
            key={item.id}
            variant="secondary"
            className="min-h-11 justify-start"
            data-testid={`remote-input-menu-${item.id}`}
            onClick={() => {
              item.onSelect();
              onOpenChange(false);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
