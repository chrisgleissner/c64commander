export type ScreenshotFramingSurface = "docs-section" | "docs-external" | "switch-device-sheet";

export type ScreenshotFramingMode = "viewport" | "surface";

export const getScreenshotFraming = (surface: ScreenshotFramingSurface): ScreenshotFramingMode => {
  switch (surface) {
    case "docs-section":
    case "docs-external":
    case "switch-device-sheet":
      return "viewport";
  }
};
