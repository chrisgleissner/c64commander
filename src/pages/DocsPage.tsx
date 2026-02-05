import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ExternalLink,
  Wifi,
  Settings,
  Play,
  Home,
  Disc,
  Sliders,
} from 'lucide-react';
import { AppBar } from '@/components/AppBar';
import { wrapUserEvent } from '@/lib/tracing/userTrace';

interface DocSection {
  id: string;
  title: string;
  icon: React.ElementType;
  content: React.ReactNode;
}

const docSections: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: Wifi,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          This app controls your <strong>C64 Ultimate</strong> device via its REST API.
          Make sure your device is:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Running firmware 3.11 or later</li>
          <li>Connected to your local network</li>
          <li>Accessible from this device (same network)</li>
        </ul>
        <p className="font-medium">Quick Setup:</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Go to <strong>Settings</strong> tab</li>
          <li>Enter your C64U's hostname or IP address</li>
          <li>If network password is set (firmware 3.12+), enter it</li>
          <li>Tap <strong>Save & Connect</strong></li>
        </ol>
      </div>
    ),
  },
  {
    id: 'home',
    title: 'Home',
    icon: Home,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The Home page shows your device info, machine controls, and a minimal drive summary.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Reset</strong> - Soft reset the C64</li>
          <li><strong>Reboot</strong> - Full reboot with cartridge re-init</li>
          <li><strong>Menu</strong> - Toggle Ultimate menu (like the button)</li>
          <li><strong>Pause/Resume</strong> - Stop/start CPU via DMA</li>
          <li><strong>Power Off</strong> - Shut down the machine</li>
        </ul>
        <p className="font-medium">Configuration Actions:</p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Save</strong> - Save current config to flash</li>
          <li><strong>Load</strong> - Restore config from flash</li>
          <li><strong>Reset</strong> - Reset to factory defaults</li>
        </ul>
        <p className="text-muted-foreground">
          Drive summary shows Drive A and Drive B status with the mounted image name.
        </p>
      </div>
    ),
  },
  {
    id: 'play',
    title: 'Play',
    icon: Play,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Browse and play files from local storage or the C64 Ultimate.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Play SID/PRG/CRT</strong> from local or Ultimate storage</li>
          <li><strong>Upload files</strong> directly to the device</li>
          <li><strong>HVSC controls</strong> appear when enabled in Settings</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'disks',
    title: 'Disks',
    icon: Disc,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Manage drives and disk images in one place.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Mount and eject disk images</li>
          <li>Enable/disable Drive A & B</li>
          <li>Rotate disks in a group</li>
          <li>Import from local storage or the Ultimate</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'config',
    title: 'Config',
    icon: Sliders,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Browse and modify <strong>all</strong> configuration settings on your C64U.
          Settings are auto-discovered from the device at runtime.
        </p>
        <p className="text-muted-foreground">
          Audio Mixer includes solo toggles for the two physical SID sockets and two UltiSID chips.
          Changes apply immediately but are not saved to flash automatically.
        </p>
      </div>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Configure connection details, appearance, diagnostics, and internal testing options.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Connection</strong> - Hostname/IP and password</li>
          <li><strong>Appearance</strong> - Light/dark/system theme</li>
          <li><strong>Diagnostics</strong> - Logs and error reports</li>
          <li><strong>Developer</strong> - HVSC and internal testing controls</li>
        </ul>
      </div>
    ),
  },
];

function DocSectionCard({ section }: { section: DocSection }) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = section.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        onClick={wrapUserEvent(() => setIsOpen(!isOpen), 'toggle', 'DocsSection', { title: section.title }, 'DocsHeader')}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <span className="font-medium">{section.title}</span>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border p-4">
              {section.content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar title="Documentation" subtitle="How to use this app" />

      <main className="container py-6 space-y-4">
        {docSections.map((section, index) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <DocSectionCard section={section} />
          </motion.div>
        ))}

        {/* External Links */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: docSections.length * 0.05 }}
          className="bg-card border border-border rounded-xl p-4 space-y-3"
        >
          <h3 className="font-medium">External Resources</h3>
          <div className="space-y-2">
            <a
              href="https://1541u-documentation.readthedocs.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Ultimate Documentation
            </a>
            <a
              href="https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              REST API Reference
            </a>
            <a
              href="https://ultimate64.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Ultimate 64 Official Site
            </a>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
