/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ConfirmDestructiveDialog } from "@/components/ConfirmDestructiveDialog";

type ClearPlaylistDialogProps = {
  open: boolean;
  itemCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const describeRemoval = (itemCount: number) =>
  itemCount === 1
    ? "This removes the 1 item in the playlist. It cannot be undone."
    : `This removes all ${itemCount} items from the playlist. It cannot be undone.`;

export const ClearPlaylistDialog = ({ open, itemCount, onOpenChange, onConfirm }: ClearPlaylistDialogProps) => (
  <ConfirmDestructiveDialog
    open={open}
    onOpenChange={onOpenChange}
    onConfirm={onConfirm}
    title="Clear playlist?"
    description={describeRemoval(itemCount)}
    confirmLabel="Clear"
    idPrefix="clear-playlist"
  />
);
