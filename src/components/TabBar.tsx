/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

const tabs = TAB_ROUTES.map((t) => ({ ...t, icon: TAB_ICONS[t.path]! }));

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
}: {
  readonly tab: Tab;
  readonly order: number;
  readonly isActive: boolean;
  readonly navigate: NavigateFunction;
}) {
  const Icon = tab.icon;
  const tabId = `tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`;
  const focusRef = useFocusItem<HTMLButtonElement>({ id: tabId, order, group: "primary-tabs" });

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
          className="pointer-events-none absolute inset-x-0.5 inset-y-0.5 -z-10 rounded-xl bg-primary/15"
        />
      )}
      <Icon className="h-[1.375rem] w-[1.375rem]" />
      <span className="text-[9px] font-medium leading-none">{tab.label}</span>
    </button>
  );
}

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const interstitialActive = useInterstitialActive();

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
        className="tab-bar app-chrome-rail app-chrome-rail-bottom"
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
          />
        ))}
      </nav>
    </div>
  );
}
