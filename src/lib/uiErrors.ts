import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';

export type UiErrorReport = {
  operation: string;
  title: string;
  description: string;
  error?: unknown;
  context?: Record<string, unknown>;
};

const buildErrorDetails = (error?: unknown) => {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  if (typeof error === 'object') {
    return { ...(error as Record<string, unknown>) };
  }
  return { message: String(error) };
};

export const reportUserError = ({
  operation,
  title,
  description,
  error,
  context,
}: UiErrorReport) => {
  addErrorLog(`${operation}: ${title}`, {
    operation,
    description,
    ...context,
    error: buildErrorDetails(error),
  });

  toast({
    title,
    description,
    variant: 'destructive',
  });
};