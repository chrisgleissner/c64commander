import { motion } from 'framer-motion';
import type { MouseEvent } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const blurOnPointerClick = (event: MouseEvent<HTMLElement>) => {
  if (event.detail === 0) return;
  const target = event.currentTarget as HTMLElement | null;
  if (target?.blur && document.activeElement === target) {
    target.blur();
  }
};

interface QuickActionCardProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'success';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  className?: string;
  dataTestId?: string;
}

export function QuickActionCard({
  icon: Icon,
  label,
  description,
  onClick,
  variant = 'default',
  disabled = false,
  loading = false,
  compact = false,
  className,
  dataTestId,
}: QuickActionCardProps) {
  const variantClasses = {
    default: 'hover:border-primary hover:bg-primary/5',
    danger: 'hover:border-destructive hover:bg-destructive/5',
    success: 'hover:border-success hover:bg-success/5',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={(event) => {
        onClick();
        blurOnPointerClick(event);
      }}
      disabled={disabled || loading}
      data-testid={dataTestId}
      className={cn(
        'quick-action',
        compact ? 'gap-1.5 p-2.5 min-h-[86px]' : null,
        variantClasses[variant],
        disabled ? 'opacity-50 cursor-not-allowed' : null,
        className,
      )}
    >
      <div className={cn(
        compact ? 'p-1.5' : 'p-2',
        'rounded-lg',
        variant === 'danger'
          ? 'bg-destructive/10 text-destructive'
          : variant === 'success'
            ? 'bg-success/10 text-success'
            : 'bg-primary/10 text-primary',
      )}>
        <Icon className={cn(compact ? 'h-5 w-5' : 'h-6 w-6', loading ? 'animate-pulse' : null)} />
      </div>
      <span className={cn('font-medium', compact ? 'text-xs leading-tight' : 'text-sm')}>{label}</span>
      {description && (
        <span className={cn('text-muted-foreground', compact ? 'text-[11px] leading-tight' : 'text-xs')}>{description}</span>
      )}
    </motion.button>
  );
}
