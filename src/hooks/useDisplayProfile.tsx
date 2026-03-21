import React from "react";

import {
  type DisplayProfile,
  type DisplayProfileOverride,
  DISPLAY_PROFILE_OVERRIDE_LABELS,
  getDisplayProfileLayoutTokens,
  resolveDisplayProfile,
  resolveEffectiveDisplayProfile,
} from "@/lib/displayProfiles";
import {
  getDisplayProfileOverride,
  setDisplayProfileOverride as persistDisplayProfileOverride,
} from "@/lib/uiPreferences";
import { APP_SETTINGS_KEYS, loadAutoRotationEnabled } from "@/lib/config/appSettings";

type DisplayProfileContextValue = {
  viewportWidth: number;
  autoProfile: DisplayProfile;
  profile: DisplayProfile;
  override: DisplayProfileOverride;
  overrideLabel: string;
  tokens: ReturnType<typeof getDisplayProfileLayoutTokens>;
  setOverride: (next: DisplayProfileOverride) => void;
};

const DEFAULT_PROFILE: DisplayProfile = "medium";

const defaultContextValue: DisplayProfileContextValue = {
  viewportWidth: 0,
  autoProfile: DEFAULT_PROFILE,
  profile: DEFAULT_PROFILE,
  override: "auto",
  overrideLabel: DISPLAY_PROFILE_OVERRIDE_LABELS.auto,
  tokens: getDisplayProfileLayoutTokens(DEFAULT_PROFILE),
  setOverride: () => undefined,
};

const DisplayProfileContext = React.createContext<DisplayProfileContextValue>(defaultContextValue);

const DISPLAY_PROFILE_ROOT_STYLE_PROPERTIES = [
  "--display-profile-root-font-size",
  "--display-profile-page-max-width",
  "--display-profile-reading-max-width",
  "--display-profile-page-padding-x",
  "--display-profile-page-padding-y",
  "--display-profile-page-padding-top",
  "--display-profile-section-gap",
  "--display-profile-panel-gap",
  "--display-profile-action-grid-gap",
  "--display-profile-action-grid-min",
  "--display-profile-modal-max-width",
  "--display-profile-modal-inset",
  "--display-profile-viewport-width",
  "--display-profile-viewport-height",
] as const;

type RootSnapshot = {
  displayProfile: string | undefined;
  styleValues: Map<(typeof DISPLAY_PROFILE_ROOT_STYLE_PROPERTIES)[number], string>;
};

const readViewportWidth = () => {
  if (typeof window === "undefined") return 0;
  return Math.max(0, Math.round(window.innerWidth || 0));
};

const readViewportHeight = () => {
  if (typeof window === "undefined") return 0;
  return Math.max(0, Math.round(window.innerHeight || 0));
};

const shouldRefreshOverrideFromStorage = (event: StorageEvent) => {
  if (event.storageArea !== localStorage) return false;
  return event.key === null || event.key === "c64u_display_profile_override";
};

const applyProfileTokens = (profile: DisplayProfile) => {
  if (typeof document === "undefined") return;
  const tokens = getDisplayProfileLayoutTokens(profile);
  const root = document.documentElement;
  root.dataset.displayProfile = profile;
  root.style.setProperty("--display-profile-root-font-size", tokens.rootFontSize);
  root.style.setProperty("--display-profile-page-max-width", tokens.pageMaxWidth);
  root.style.setProperty("--display-profile-reading-max-width", tokens.readingMaxWidth);
  root.style.setProperty("--display-profile-page-padding-x", tokens.pagePaddingX);
  root.style.setProperty("--display-profile-page-padding-y", tokens.pagePaddingY);
  root.style.setProperty("--display-profile-page-padding-top", tokens.pagePaddingTop);
  root.style.setProperty("--display-profile-section-gap", tokens.sectionGap);
  root.style.setProperty("--display-profile-panel-gap", tokens.panelGap);
  root.style.setProperty("--display-profile-action-grid-gap", tokens.actionGridGap);
  root.style.setProperty("--display-profile-action-grid-min", tokens.actionGridMinWidth);
  root.style.setProperty("--display-profile-modal-max-width", tokens.modalMaxWidth);
  root.style.setProperty("--display-profile-modal-inset", tokens.modalInset);
};

const applyViewportTokens = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--display-profile-viewport-width", `${readViewportWidth()}px`);
  root.style.setProperty("--display-profile-viewport-height", `${readViewportHeight()}px`);
};

const snapshotRootState = (): RootSnapshot | null => {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  return {
    displayProfile: root.dataset.displayProfile,
    styleValues: new Map(
      DISPLAY_PROFILE_ROOT_STYLE_PROPERTIES.map((property) => [property, root.style.getPropertyValue(property)]),
    ),
  };
};

const restoreRootState = (snapshot: RootSnapshot | null) => {
  if (!snapshot || typeof document === "undefined") return;
  const root = document.documentElement;
  if (snapshot.displayProfile === undefined) {
    delete root.dataset.displayProfile;
  } else {
    root.dataset.displayProfile = snapshot.displayProfile;
  }
  for (const property of DISPLAY_PROFILE_ROOT_STYLE_PROPERTIES) {
    const value = snapshot.styleValues.get(property) ?? "";
    if (value) {
      root.style.setProperty(property, value);
    } else {
      root.style.removeProperty(property);
    }
  }
};

export function DisplayProfileProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverrideState] = React.useState<DisplayProfileOverride>(() => getDisplayProfileOverride());
  const [viewportWidth, setViewportWidth] = React.useState(() => readViewportWidth());
  const [autoRotationEnabled, setAutoRotationEnabled] = React.useState(() => loadAutoRotationEnabled());

  // Permanent effect: root state snapshot/restore, preferences, storage,
  // and settings events. Runs once on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const rootSnapshot = snapshotRootState();

    const handlePreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ displayProfileOverride?: DisplayProfileOverride }>).detail;
      if (detail?.displayProfileOverride) {
        setOverrideState(detail.displayProfileOverride);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (!shouldRefreshOverrideFromStorage(event)) return;
      setOverrideState(getDisplayProfileOverride());
    };
    const handleSettingsUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail.key === APP_SETTINGS_KEYS.AUTO_ROTATION_ENABLED_KEY) {
        setAutoRotationEnabled(Boolean(detail.value));
      }
    };

    window.addEventListener("c64u-ui-preferences-changed", handlePreferences as EventListener);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("c64u-app-settings-updated", handleSettingsUpdate);

    // Set initial viewport width and tokens regardless of rotation setting.
    setViewportWidth(readViewportWidth());
    applyViewportTokens();

    return () => {
      window.removeEventListener("c64u-ui-preferences-changed", handlePreferences as EventListener);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("c64u-app-settings-updated", handleSettingsUpdate);
      restoreRootState(rootSnapshot);
    };
  }, []);

  // Resize/orientation effect: only active when auto-rotation is enabled.
  // When disabled, viewport width is frozen at the initial mount value so
  // device rotation never changes the display profile.
  // orientationchange uses a short timeout so the browser has time to update
  // viewport dimensions before we read them (fixes the "stuck in landscape"
  // revert bug on Android).
  React.useEffect(() => {
    if (typeof window === "undefined" || !autoRotationEnabled) return undefined;

    const handleResize = () => {
      setViewportWidth(readViewportWidth());
      applyViewportTokens();
    };

    let orientationTimer: ReturnType<typeof setTimeout> | null = null;
    const handleOrientationChange = () => {
      if (orientationTimer !== null) clearTimeout(orientationTimer);
      orientationTimer = setTimeout(() => {
        orientationTimer = null;
        setViewportWidth(readViewportWidth());
        applyViewportTokens();
      }, 150);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("orientationchange", handleOrientationChange);

    // Snap to current viewport immediately when auto-rotation is enabled.
    handleResize();

    return () => {
      if (orientationTimer !== null) clearTimeout(orientationTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, [autoRotationEnabled]);

  const setOverride = React.useCallback((next: DisplayProfileOverride) => {
    setOverrideState(next);
    persistDisplayProfileOverride(next);
  }, []);

  const value = React.useMemo<DisplayProfileContextValue>(() => {
    const autoProfile = resolveDisplayProfile(viewportWidth);
    const profile = resolveEffectiveDisplayProfile(viewportWidth, override);
    return {
      viewportWidth,
      autoProfile,
      profile,
      override,
      overrideLabel: DISPLAY_PROFILE_OVERRIDE_LABELS[override],
      tokens: getDisplayProfileLayoutTokens(profile),
      setOverride,
    };
  }, [override, setOverride, viewportWidth]);

  React.useEffect(() => {
    applyProfileTokens(value.profile);
  }, [value.profile]);

  return <DisplayProfileContext.Provider value={value}>{children}</DisplayProfileContext.Provider>;
}

export const useDisplayProfile = () => React.useContext(DisplayProfileContext);

export const useDisplayProfilePreference = () => {
  const { override, setOverride, autoProfile } = useDisplayProfile();
  return {
    override,
    autoProfile,
    setOverride,
  };
};
