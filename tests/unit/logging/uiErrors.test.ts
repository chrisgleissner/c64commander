import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';

describe('reportUserError', () => {
  it('logs and shows a destructive toast', () => {
    const error = new Error('Boom');
    reportUserError({
      operation: 'TEST_OP',
      title: 'Failure',
      description: 'Something went wrong',
      error,
      context: { extra: 'context' },
    });

    expect(addErrorLog).toHaveBeenCalledWith('TEST_OP: Failure', expect.objectContaining({
      operation: 'TEST_OP',
      description: 'Something went wrong',
      extra: 'context',
    }));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failure',
      description: 'Something went wrong',
      variant: 'destructive',
    }));
  });
});
