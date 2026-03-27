import { describe, expect, it } from 'vitest';

import { toDiffOutputRelativePath } from '../../../scripts/diff-screenshots.mjs';

describe('toDiffOutputRelativePath', () => {
  it('strips the current docs screenshot root from tracked screenshot paths', () => {
    expect(toDiffOutputRelativePath('docs/img/app/home/00-overview-light.png')).toBe('home/00-overview-light.png');
  });

  it('leaves non-app screenshot paths unchanged', () => {
    expect(toDiffOutputRelativePath('docs/img/setup/enable_services.png')).toBe('docs/img/setup/enable_services.png');
  });
});
