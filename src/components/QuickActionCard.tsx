import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface QuickActionCardProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'success';
  disabled?: boolean;
  loading?: boolean;
}

export function QuickActionCard({
  icon: Icon,
  label,
  description,
  onClick,
  variant = 'default',
  disabled = false,
  loading = false,
}: QuickActionCardProps) {
  const variantClasses = {
    default: 'hover:border-primary hover:bg-primary/5',
    danger: 'hover:border-destructive hover:bg-destructive/5',
    success: 'hover:border-success hover:bg-success/5',
  };

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={disabled || loading}
      className={`quick-action ${variantClasses[variant]} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      <div className={`p-2 rounded-lg ${
        variant === 'danger' 
          ? 'bg-destructive/10 text-destructive' 
          : variant === 'success'
            ? 'bg-success/10 text-success'
            : 'bg-primary/10 text-primary'
      }`}>
        <Icon className={`h-6 w-6 ${loading ? 'animate-pulse' : ''}`} />
      </div>
      <span className="font-medium text-sm">{label}</span>
      {description && (
        <span className="text-xs text-muted-foreground">{description}</span>
      )}
    </motion.button>
  );
}
