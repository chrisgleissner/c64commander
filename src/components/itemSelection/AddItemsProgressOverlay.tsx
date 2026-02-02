import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AddItemsProgressState = {
  status: 'idle' | 'scanning' | 'error' | 'done';
  count: number;
  elapsedMs: number;
  total: number | null;
  message: string | null;
};

type AddItemsProgressOverlayProps = {
  progress: AddItemsProgressState;
  title?: string;
  testId?: string;
  visible?: boolean;
  onCancel?: () => void;
};

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const AddItemsProgressOverlay = ({
  progress,
  title = 'Scanning…',
  testId,
  visible,
  onCancel,
}: AddItemsProgressOverlayProps) => {
  if (visible === false) return null;
  if (visible !== true && progress.status !== 'scanning') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      data-testid={testId}
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-2xl border border-border bg-background px-5 py-4 shadow-2xl',
          'max-h-[calc(100dvh-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{title}</p>
          <span className="text-xs text-muted-foreground">{formatElapsed(progress.elapsedMs)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {progress.message || 'Scanning files'} • {progress.count} found
          {progress.total ? ` / ${progress.total}` : ''}
        </p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70" />
        </div>
        {onCancel ? (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
