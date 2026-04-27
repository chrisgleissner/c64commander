/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { motion } from "framer-motion";
import { Home, Sliders, Settings, BookOpen, Play, Disc } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useInterstitialActive } from "@/components/ui/interstitial-state";
import { INTERSTITIAL_Z_INDEX } from "@/components/ui/interstitialStyles";
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
      <nav className="tab-bar app-chrome-rail app-chrome-rail-bottom bg-background" data-app-chrome-family="primary">
        {tabs.map((tab) => {
          const isActive = tabIndexForPath(location.pathname) === tabIndexForPath(tab.path);
          const Icon = tab.icon;
          const tabId = `tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`;

          return (
            <button
              key={tab.path}
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
              className={`tab-item touch-none ${isActive ? "active" : ""}`}
            >
              <div className="relative">
                <Icon className="h-[1.375rem] w-[1.375rem]" />
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </div>
              <span className="text-[9px] font-medium leading-none">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
