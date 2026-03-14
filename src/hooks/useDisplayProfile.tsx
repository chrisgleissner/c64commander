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

const readViewportWidth = () => {
  if (typeof window === "undefined") return 0;
  return Math.max(0, Math.round(window.innerWidth || 0));
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
  root.style.setProperty("--display-profile-section-gap", tokens.sectionGap);
  root.style.setProperty("--display-profile-panel-gap", tokens.panelGap);
  root.style.setProperty("--display-profile-action-grid-gap", tokens.actionGridGap);
  root.style.setProperty("--display-profile-action-grid-min", tokens.actionGridMinWidth);
  root.style.setProperty("--display-profile-modal-max-width", tokens.modalMaxWidth);
  root.style.setProperty("--display-profile-modal-inset", tokens.modalInset);
};

export function DisplayProfileProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverrideState] = React.useState<DisplayProfileOverride>(() => getDisplayProfileOverride());
  const [viewportWidth, setViewportWidth] = React.useState(() => readViewportWidth());

  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleResize = () => {
      setViewportWidth(readViewportWidth());
    };
    const handlePreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ displayProfileOverride?: DisplayProfileOverride }>).detail;
      if (detail?.displayProfileOverride) {
        setOverrideState(detail.displayProfileOverride);
      }
    };
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("orientationchange", handleResize);
    window.addEventListener("c64u-ui-preferences-changed", handlePreferences as EventListener);
    handleResize();
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.removeEventListener("c64u-ui-preferences-changed", handlePreferences as EventListener);
    };
  }, []);

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
