import { cn } from '@/lib/utils';

type PathWrapProps = {
  path: string;
  className?: string;
};

export const PathWrap = ({ path, className }: PathWrapProps) => {
  if (!path) return null;
  const parts = String(path).split(/([\\/])/g);
  return (
    <span className={cn('break-normal whitespace-normal', className)}>
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
