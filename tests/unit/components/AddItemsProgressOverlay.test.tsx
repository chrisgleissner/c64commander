/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddItemsProgressOverlay } from '@/components/itemSelection/AddItemsProgressOverlay';

const buildProgress = (overrides?: Partial<Parameters<typeof AddItemsProgressOverlay>[0]['progress']>) => ({
  status: 'scanning' as const,
  count: 3,
  elapsedMs: 65000,
  total: 10,
  message: 'Scanning now',
  ...overrides,
});

describe('AddItemsProgressOverlay', () => {
  it('renders nothing when visibility is disabled', () => {
    const { container } = render(
      <AddItemsProgressOverlay progress={buildProgress()} visible={false} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders progress details and handles cancel', () => {
    const onCancel = vi.fn();

    render(
      <AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />,
    );

    expect(screen.getByTestId('progress')).toBeInTheDocument();
    expect(screen.getByText(/Scanning now/)).toBeInTheDocument();
    expect(screen.getByText(/3 found/)).toBeInTheDocument();
    expect(screen.getByText('01:05')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides when not scanning and visibility is undefined', () => {
    const { container } = render(
      <AddItemsProgressOverlay progress={buildProgress({ status: 'done' })} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
