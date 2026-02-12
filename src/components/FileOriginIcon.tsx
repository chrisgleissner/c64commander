/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from '@/lib/utils';
import { Library } from 'lucide-react';

type FileOrigin = 'ultimate' | 'local' | 'hvsc';

type FileOriginIconProps = {
  origin: FileOrigin;
  className?: string;
  label?: string;
};

const resolveIconSource = (origin: FileOrigin) => {
  const base = typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL || '/' : '/';
  if (origin === 'ultimate') return `${base}c64u-icon.svg`;
  return `${base}device-icon.svg`;
};

const resolveIconLabel = (origin: FileOrigin) =>
  origin === 'ultimate' ? 'C64U file' : origin === 'hvsc' ? 'HVSC file' : 'Local file';

export const FileOriginIcon = ({ origin, className, label }: FileOriginIconProps) => {
  if (origin === 'hvsc') {
    return (
      <Library
        aria-label={label ?? resolveIconLabel(origin)}
        data-testid="file-origin-icon"
        className={cn('h-4 w-4 shrink-0 opacity-70', className)}
      />
    );
  }
  return (
    <img
      src={resolveIconSource(origin)}
      alt={label ?? resolveIconLabel(origin)}
      aria-label={label ?? resolveIconLabel(origin)}
      data-testid="file-origin-icon"
      className={cn('h-4 w-4 shrink-0 opacity-70 dark:invert dark:brightness-0', className)}
    />
  );
};
