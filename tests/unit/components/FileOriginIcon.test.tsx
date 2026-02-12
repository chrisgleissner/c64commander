/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileOriginIcon } from '@/components/FileOriginIcon';

describe('FileOriginIcon', () => {
  it('renders the ultimate icon as image', () => {
    render(<FileOriginIcon origin="ultimate" />);
    const icon = screen.getByTestId('file-origin-icon');
    expect(icon.tagName).toBe('IMG');
    expect(icon).toHaveAttribute('alt', 'C64U file');
  });

  it('renders the local icon as image', () => {
    render(<FileOriginIcon origin="local" />);
    const icon = screen.getByTestId('file-origin-icon');
    expect(icon.tagName).toBe('IMG');
    expect(icon).toHaveAttribute('alt', 'Local file');
  });

  it('renders the hvsc icon distinctly', () => {
    render(<FileOriginIcon origin="hvsc" />);
    const icon = screen.getByTestId('file-origin-icon');
    expect(icon.tagName).toBe('svg');
    expect(icon).toHaveAttribute('aria-label', 'HVSC file');
  });
});
