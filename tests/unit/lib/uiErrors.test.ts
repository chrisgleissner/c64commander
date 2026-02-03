import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportUserError } from '@/lib/uiErrors';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

describe('uiErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports basic error to log and toast', () => {
    reportUserError({
      operation: 'TEST_OP',
      title: 'Something failed',
      description: 'Please try again',
    });

    expect(addErrorLog).toHaveBeenCalledWith('TEST_OP: Something failed', {
      operation: 'TEST_OP',
      description: 'Please try again',
      error: undefined,
    });

    expect(toast).toHaveBeenCalledWith({
      title: 'Something failed',
      description: 'Please try again',
      variant: 'destructive',
    });
  });

  it('includes context in error log', () => {
    reportUserError({
      operation: 'TEST_OP',
      title: 'Error',
      description: 'Desc',
      context: { userId: 123, action: 'save' },
    });

    expect(addErrorLog).toHaveBeenCalledWith(expect.stringContaining('TEST_OP'), expect.objectContaining({
      userId: 123,
      action: 'save',
    }));
  });

  describe('error object processing', () => {
    it('handles Error instances', () => {
      const error = new Error('System crash');
      error.stack = 'Error: System crash\n    at test.ts:1:1';

      reportUserError({
        operation: 'TEST_crash',
        title: 'Crash',
        description: 'Boom',
        error,
      });

      expect(addErrorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        error: {
          name: 'Error',
          message: 'System crash',
          stack: 'Error: System crash\n    at test.ts:1:1',
        },
      }));
    });

    it('handles string errors', () => {
      reportUserError({
        operation: 'TEST_string',
        title: 'Str',
        description: 'Desc',
        error: 'Network timeout',
      });

      expect(addErrorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        error: { message: 'Network timeout' },
      }));
    });

    it('handles object errors', () => {
      const customErr = { code: 500, detail: 'Server error' };
      reportUserError({
        operation: 'TEST_obj',
        title: 'Obj',
        description: 'Desc',
        error: customErr,
      });

      expect(addErrorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        error: { code: 500, detail: 'Server error' },
      }));
    });

    it('handles unknown primitives', () => {
      reportUserError({
        operation: 'TEST_prim',
        title: 'Prim',
        description: 'Desc',
        error: 42,
      });

      expect(addErrorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        error: { message: '42' },
      }));
    });
  });
});
