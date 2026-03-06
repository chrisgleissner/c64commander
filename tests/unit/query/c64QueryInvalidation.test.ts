import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  getRouteInvalidationPrefixes,
  invalidateForConnectionSettingsChange,
  invalidateForConnectionStateTransition,
  invalidateForRouteChange,
} from '@/lib/query/c64QueryInvalidation';

describe('c64QueryInvalidation', () => {
  it('maps config route to config-focused prefixes', () => {
    expect(getRouteInvalidationPrefixes('/config')).toEqual([
      'c64-info',
      'c64-categories',
      'c64-category',
      'c64-config-item',
      'c64-config-items',
      'c64-all-config',
    ]);
  });

  it('maps unknown routes to info-only invalidation', () => {
    expect(getRouteInvalidationPrefixes('/unknown')).toEqual(['c64-info']);
  });

  it('normalizes empty pathname to root and returns home prefixes (BRDA:59)', () => {
    // pathname.trim() returns '' → falsy → || '/' fallback; normalizedPath='/'
    // routePrefix==='/' entry matches only when normalizedPath==='/'
    const prefixes = getRouteInvalidationPrefixes('');
    expect(prefixes).toContain('c64-info');
    expect(prefixes).toContain('c64-drives');
  });

  it('invalidates route prefixes using query keys instead of broad predicates', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForRouteChange(queryClient, '/disks');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-info'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-drives'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['c64-config-items'],
    });
    expect(invalidateSpy.mock.calls.some(([arg]) => 'predicate' in arg)).toBe(
      false,
    );
  });

  it('invalidates all targeted connection-setting prefixes', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForConnectionSettingsChange(queryClient);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-info'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-drives'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['c64-categories'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-category'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['c64-config-item'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['c64-config-items'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['c64-all-config'],
    });
  });

  it('invalidates on meaningful connection state transitions only', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateForConnectionStateTransition(
      queryClient,
      'DISCOVERING',
      'REAL_CONNECTED',
    );
    invalidateForConnectionStateTransition(
      queryClient,
      'REAL_CONNECTED',
      'DISCOVERING',
    );
    invalidateForConnectionStateTransition(
      queryClient,
      'DISCOVERING',
      'DISCOVERING',
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['c64-info'] });
    expect(
      invalidateSpy.mock.calls.filter(
        ([arg]) =>
          JSON.stringify(arg) === JSON.stringify({ queryKey: ['c64-info'] }),
      ).length,
    ).toBe(2);
    expect(invalidateSpy.mock.calls.length).toBe(2);
  });
});
