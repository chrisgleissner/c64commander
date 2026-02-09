/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from '@/lib/utils';

type PathWrapProps = {
  path: string;
  className?: string;
};

export const PathWrap = ({ path, className }: PathWrapProps) => {
  if (!path) return null;
  const parts = String(path).split(/([\\/])/g);
  return (
    <span className={cn('break-words whitespace-normal', className)}>
      {parts.map((part, index) =>
        part === '/' || part === '\\' ? (
          <span key={`${part}-${index}`}>
            {part}
            <wbr />
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </span>
  );
};
