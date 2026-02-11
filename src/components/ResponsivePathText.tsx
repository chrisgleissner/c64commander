/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useResponsivePathLabel, type PathDisplayMode } from '@/lib/ui/pathDisplay';
import { cn } from '@/lib/utils';

type ResponsivePathTextProps = {
  path: string;
  mode: PathDisplayMode;
  className?: string;
  fallback?: string;
  dataTestId?: string;
};

export const ResponsivePathText = ({
  path,
  mode,
  className,
  fallback = '—',
  dataTestId,
}: ResponsivePathTextProps) => {
  const source = path.trim() || fallback;
  const { elementRef, label } = useResponsivePathLabel(source, mode);

  return (
    <span
      ref={(node) => {
        elementRef.current = node;
      }}
      className={cn('block min-w-0', className)}
      title={source}
      data-testid={dataTestId}
    >
      {label || fallback}
    </span>
  );
};
