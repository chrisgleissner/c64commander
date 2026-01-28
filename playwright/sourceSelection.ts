import type { Locator, Page } from '@playwright/test';

export type SourceSelectionLabel = 'C64 Ultimate' | 'This device';

export const getSourceSelectionButton = (container: Page | Locator, label: SourceSelectionLabel) =>
  container
    .getByText(label, { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Add file / folder' });

export const clickSourceSelectionButton = async (
  container: Page | Locator,
  label: SourceSelectionLabel,
  options: { force?: boolean } = {},
) => {
  await getSourceSelectionButton(container, label).click({ force: options.force });
};
