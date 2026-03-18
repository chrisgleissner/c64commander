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
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { TAB_ROUTES, tabIndexForPath } from "@/lib/navigation/tabRoutes";

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

  return (
    <div className="fixed bottom-0 left-0 z-50 w-screen max-w-screen">
      <nav className="tab-bar">
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
              onClick={wrapUserEvent(() => navigate(tab.path), "click", "Tab", { title: tab.label }, "Tab")}
              className={`tab-item touch-none ${isActive ? "active" : ""}`}
            >
              <div className="relative">
                <Icon className="h-6 w-6" />
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
