import type { Locator, Page } from '@playwright/test';

export type SourceSelectionLabel = 'C64 Ultimate' | 'This device';

const getInterstitialTestId = (label: SourceSelectionLabel) =>
  (label === 'C64 Ultimate' ? 'import-option-c64u' : 'import-option-local');

export const getSourceSelectionButton = (container: Page | Locator, label: SourceSelectionLabel) =>
  container.getByTestId(getInterstitialTestId(label)).or(
    container
      .getByText(label, { exact: true })
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
