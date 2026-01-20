import { motion } from 'framer-motion';
import { Home, Sliders, Settings, BookOpen, Cpu, Music } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MockModeBanner } from '@/components/MockModeBanner';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { isSidPlayerEnabled } from '@/lib/config/featureFlags';

const baseTabs = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/quick', icon: Cpu, label: 'Quick' },
  { path: '/config', icon: Sliders, label: 'Config' },
  { path: '/music', icon: Music, label: 'SID' },
  { path: '/settings', icon: Settings, label: 'Settings' },
  { path: '/docs', icon: BookOpen, label: 'Docs' },
];

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { flags } = useFeatureFlags();
  const sidEnabled = isSidPlayerEnabled(flags);
  const tabs = sidEnabled ? baseTabs : baseTabs.filter((tab) => tab.path !== '/music');

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <MockModeBanner />
      <nav className="tab-bar">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          const Icon = tab.icon;

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
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
