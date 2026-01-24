import type { ReactNode } from 'react';
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
};

export function AppBar({ title, subtitle, leading, children }: Props) {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {leading ? (
              leading
            ) : (
              <>
                <h1 className="c64-header text-xl truncate">{title}</h1>
                {subtitle ? (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
                ) : null}
              </>
            )}
          </div>
          <ConnectivityIndicator />
        </div>
        {children ? <div className="min-w-0">{children}</div> : null}
      </div>
    </header>
  );
}

