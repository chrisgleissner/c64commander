/**
 * LED Strip Fixed Colors
 * Values mirror the C64 Ultimate firmware definitions in 1541ultimate/software/u64/led_strip.cc
 */
export const LED_FIXED_COLORS = [
    { name: 'Red', rgb: { r: 255, g: 0, b: 0 } },
    { name: 'Scarlet', rgb: { r: 255, g: 44, b: 0 } },
    { name: 'Orange', rgb: { r: 255, g: 128, b: 0 } },
    { name: 'Amber', rgb: { r: 255, g: 192, b: 0 } },
    { name: 'Yellow', rgb: { r: 255, g: 255, b: 0 } },
    { name: 'Lemon-Lime', rgb: { r: 190, g: 255, b: 0 } },
    { name: 'Chartreuse', rgb: { r: 128, g: 255, b: 0 } },
    { name: 'Lime', rgb: { r: 0, g: 255, b: 0 } },
    { name: 'Green', rgb: { r: 0, g: 255, b: 128 } },
    { name: 'Jade', rgb: { r: 0, g: 255, b: 192 } },
    { name: 'Spring Green', rgb: { r: 0, g: 255, b: 255 } },
    { name: 'Aquamarine', rgb: { r: 0, g: 128, b: 255 } },
    { name: 'Cyan', rgb: { r: 0, g: 0, b: 255 } },
    { name: 'Deep Sky Blue', rgb: { r: 0, g: 128, b: 255 } },
    { name: 'Azure', rgb: { r: 0, g: 192, b: 255 } },
    { name: 'Royal Blue', rgb: { r: 0, g: 64, b: 255 } },
    { name: 'Blue', rgb: { r: 0, g: 0, b: 255 } },
    { name: 'Indigo', rgb: { r: 64, g: 0, b: 255 } },
    { name: 'Violet', rgb: { r: 128, g: 0, b: 255 } },
    { name: 'Purple', rgb: { r: 192, g: 0, b: 255 } },
    { name: 'Magenta', rgb: { r: 255, g: 0, b: 255 } },
    { name: 'Fuchsia', rgb: { r: 255, g: 0, b: 192 } },
    { name: 'Rose', rgb: { r: 255, g: 0, b: 128 } },
    { name: 'Cerise', rgb: { r: 255, g: 0, b: 64 } },
    { name: 'White', rgb: { r: 255, g: 255, b: 255 } },
] as const;

export type LedColorName = (typeof LED_FIXED_COLORS)[number]['name'];

/**
 * Convert RGB values to CSS rgb() string
 */
export const rgbToCss = (rgb: { r: number; g: number; b: number }): string =>
    `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

/**
 * Get RGB values for a given color name
 */
export const getLedColorRgb = (name: string): { r: number; g: number; b: number } | null => {
    const found = LED_FIXED_COLORS.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    return found?.rgb ?? null;
};
