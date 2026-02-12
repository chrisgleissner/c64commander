/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Locator, Page } from '@playwright/test';

export type SourceSelectionLabel = 'C64U' | 'Local' | 'HVSC' | 'C64 Ultimate' | 'This device';

const getInterstitialTestId = (label: SourceSelectionLabel) => {
  if (label === 'C64U' || label === 'C64 Ultimate') return 'import-option-c64u';
  if (label === 'HVSC') return 'import-option-hvsc';
  return 'import-option-local';
};

const normalizeLabel = (label: SourceSelectionLabel): 'C64U' | 'Local' | 'HVSC' => {
  if (label === 'C64 Ultimate') return 'C64U';
  if (label === 'This device') return 'Local';
  return label;
};

export const getSourceSelectionButton = (container: Page | Locator, label: SourceSelectionLabel) =>
  container.getByTestId(getInterstitialTestId(label)).or(
    container
      .getByText(normalizeLabel(label), { exact: true })
      .locator('..')
      .getByRole('button', { name: 'Add file / folder' }),
  );

export const clickSourceSelectionButton = async (
  container: Page | Locator,
  label: SourceSelectionLabel,
  options: { force?: boolean } = {},
) => {
  const interstitial = container.getByTestId(getInterstitialTestId(label));
  if (await interstitial.count()) {
    await interstitial.click({ force: options.force });
    return;
  }
  await getSourceSelectionButton(container, label).click({ force: options.force });
};
