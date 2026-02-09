/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const getOnOffButtonClass = (enabled: boolean) =>
    enabled
        ? 'bg-success/15 text-success border-success/40 hover:bg-success/25 hover:text-success'
        : 'bg-muted text-muted-foreground border-muted/60 hover:bg-muted/80 hover:text-muted-foreground';
