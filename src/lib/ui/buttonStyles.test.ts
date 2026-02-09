import { describe, expect, it } from 'vitest';

import { getOnOffButtonClass } from './buttonStyles';

describe('getOnOffButtonClass', () => {
    it('uses success styling when enabled', () => {
        const className = getOnOffButtonClass(true);
        expect(className).toContain('bg-success/15');
        expect(className).toContain('text-success');
    });

    it('uses muted styling when disabled', () => {
        const className = getOnOffButtonClass(false);
        expect(className).toContain('bg-muted');
        expect(className).toContain('text-muted-foreground');
    });
});
