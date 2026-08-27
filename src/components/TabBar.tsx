/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { Home, Sliders, Settings, BookOpen, Play, Disc } from "lucide-react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { INTERSTITIAL_Z_INDEX } from "@/components/ui/interstitialStyles";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { TAB_ROUTES, tabIndexForPath } from "@/lib/navigation/tabRoutes";
import { handlePointerButtonClick } from "@/lib/ui/buttonInteraction";
import { cn } from "@/lib/utils";

const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/": Home,
  "/play": Play,
  "/disks": Disc,
  "/config": Sliders,
  "/settings": Settings,
  "/docs": BookOpen,
};

const tabs = TAB_ROUTES.map((t) => ({ ...t, icon: TAB_ICONS[t.path] }));

/**
 * Base focus order for the bottom tab bar. The keypad focus ring (C64U Remote)
 * traverses page content first, so the persistent primary tabs sit after it.
 * Inside a {@link FocusNavigationProvider} this registers each tab for d-pad
 * traversal + center-activation; outside one (default variant) it is inert.
 */
const TAB_FOCUS_ORDER_BASE = 1000;

type Tab = (typeof tabs)[number];

function TabBarButton({
  tab,
  order,
  isActive,
  navigate,
  activeRef,
}: {
  readonly tab: Tab;
  readonly order: number;
  readonly isActive: boolean;
  readonly navigate: NavigateFunction;
  readonly activeRef?: React.RefObject<HTMLButtonElement>;
}) {
  const Icon = tab.icon;
  const tabId = `tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`;
  const keypadRef = useFocusItem<HTMLButtonElement>({ id: tabId, order, group: "primary-tabs" });
  // The keypad ring owns one ref; the bar needs the active node too, to scroll it into view.
  const focusRef = (node: HTMLButtonElement | null) => {
    if (typeof keypadRef === "function") keypadRef(node);
    else if (keypadRef) (keypadRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
    if (isActive && activeRef) (activeRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
  };

  return (
    <button
      ref={focusRef}
      id={tabId}
      data-testid={tabId}
      aria-label={tab.label}
      aria-current={isActive ? "page" : undefined}
      title={tab.label}
      onClick={wrapUserEvent(
        (event) => {
          handlePointerButtonClick(event);
          navigate(tab.path);
        },
        "click",
        "Tab",
        { title: tab.label },
        "Tab",
      )}
      className={cn("tab-item touch-none relative isolate", isActive && "active")}
    >
      {/* A calm rounded highlight sitting behind the active tab's icon + label
          (the active icon/label are already tinted `text-primary` by
          `.tab-item.active`). Static: it just appears on the selected tab with
          no slide animation, sized close to the button's own bounds (like the
          tap-feedback flash) so it fully engulfs the icon + label. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0.5 inset-y-0.5 -z-10 rounded-panel bg-primary/15"
        />
      )}
      <Icon className="h-[1.375rem] w-[1.375rem]" />
      {/* On the type scale, not the 9px literal this used to be. These six labels are
          the app's primary navigation, and 9px is about 1.4mm tall on a small phone
          panel - below what a sighted adult with ordinary age-related long sight reads
          at arm's length without effort.

          `text-xs` is 12px here and 16px on the compact profile, but the compact
          profile then overrides this label specifically to 14.4px: at 16px the six
          labels plus the 44px minimum tab width no longer fit a 320px screen and "Docs"
          was clipped off the right edge. 14.4px still clears the 14px floor that
          smallScreenErgonomics.spec.ts enforces. See `.tab-item-label` in index.css. */}
      <span className="tab-item-label text-xs font-medium leading-none">{tab.label}</span>
    </button>
  );
}

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const interstitialActive = useInterstitialActive();
  const navRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  /*
   * Keep the selected tab on screen.
   *
   * The bar scrolls (`overflow-x-auto` in index.css) because six labels do not fit 320 CSS px at
   * the larger Text sizes — "Docs", the last one, is the one drawn past the edge. Scrolling alone
   * is not enough: a page reached any other way (the Quick menu, a deep link, the keypad) left the
   * bar wherever it happened to be, so the tab for the page you are on could be the one off screen.
   * `inline: "nearest"` moves it the minimum distance, so a tab already visible does not jog.
   */
  useEffect(() => {
    const nav = navRef.current;
    const active = activeTabRef.current;
    if (!nav || !active) return;
    if (nav.scrollWidth <= nav.clientWidth + 1) return;
    const reduced = document.documentElement.dataset.c64MotionMode === "reduced";
    active.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [location.pathname]);

  return (
    <div
      className={cn(
        "tab-bar-frame fixed bottom-0 left-0 w-screen max-w-screen transition-transform duration-200 ease-out",
        interstitialActive && "translate-y-full pointer-events-none",
      )}
      style={{ zIndex: INTERSTITIAL_Z_INDEX.content }}
      data-interstitial-active={interstitialActive ? "true" : "false"}
    >
      <nav
        ref={navRef}
        className="tab-bar app-chrome-rail app-chrome-rail-bottom bg-background"
        data-app-chrome-family="primary"
        data-focus-scope="tabbar"
      >
        {tabs.map((tab, index) => (
          <TabBarButton
            key={tab.path}
            tab={tab}
            order={TAB_FOCUS_ORDER_BASE + index}
            isActive={tabIndexForPath(location.pathname) === tabIndexForPath(tab.path)}
            navigate={navigate}
            activeRef={activeTabRef}
          />
        ))}
      </nav>
    </div>
  );
}
