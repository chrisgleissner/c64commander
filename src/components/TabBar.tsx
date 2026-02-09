/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { motion } from 'framer-motion';
import { Home, Sliders, Settings, BookOpen, Play, Disc } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { wrapUserEvent } from '@/lib/tracing/userTrace';

const baseTabs = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/play', icon: Play, label: 'Play' },
  { path: '/disks', icon: Disc, label: 'Disks' },
  { path: '/config', icon: Sliders, label: 'Config' },
  { path: '/settings', icon: Settings, label: 'Settings' },
  { path: '/docs', icon: BookOpen, label: 'Docs' },
];

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = baseTabs;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <nav className="tab-bar">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          const Icon = tab.icon;
          const tabId = `tab-${tab.label.toLowerCase().replace(/\s+/g, '-')}`;

          return (
            <button
              key={tab.path}
              id={tabId}
              data-testid={tabId}
              onClick={wrapUserEvent(() => navigate(tab.path), 'click', 'Tab', { title: tab.label }, 'Tab')}
              className={`tab-item touch-none ${isActive ? 'active' : ''}`}
            >
              <div className="relative">
                <Icon className="h-6 w-6" />
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
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
