/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  Activity,
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
          C64 Commander connects to your <strong>C64 Ultimate</strong> over the REST API. Stay on the same network and
          make sure the device is reachable.
        </p>
        <p className="font-medium">Connect in 4 steps:</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Open <strong>Settings</strong> → <strong>Connection</strong>.</li>
          <li>Enter the C64U hostname or IP address.</li>
          <li>Enter the network password if your device uses one.</li>
          <li>Tap <strong>Save & Connect</strong>.</li>
        </ol>
        <p className="text-muted-foreground">
          Use the C64U status pill in the header to see connection state and tap it to force a new discovery.
          If no device is found, Demo Mode can be offered for exploration.
        </p>
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
          Home is the operational dashboard: system info, machine controls, and high-value configuration shortcuts.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Reset / Reboot</strong> control the C64U CPU and system state.</li>
          <li><strong>Menu</strong> toggles the Ultimate menu (same as the hardware button).</li>
          <li><strong>Pause / Resume</strong> stops or restarts the CPU via DMA.</li>
          <li><strong>Power Off</strong> shuts down the machine.</li>
        </ul>
        <p className="text-muted-foreground">
          System info is collapsed by default, with version and firmware visible at a glance. The drive summary shows
          mounted media for Drive A/B, with quick CPU and video/LED shortcuts nearby.
        </p>
      </div>
    ),
  },
  {
    id: 'play',
    title: 'Play Files',
    icon: Play,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Use Play to find files, build a playlist, and control playback. Supported file types include SID, PRG, and CRT.
        </p>
        <p className="font-medium">Find and play files:</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Open <strong>Play</strong> and tap <strong>Add items</strong>.</li>
          <li>Pick a source: <strong>C64 Ultimate</strong>, <strong>This device</strong>, or <strong>HVSC</strong> (if enabled).</li>
          <li>Browse folders, select files or folders, then confirm.</li>
          <li>Use <strong>Play</strong> on the playlist or a single item.</li>
        </ol>
        <p className="font-medium">Playback controls:</p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Play, pause, stop, next/previous track, and shuffle/repeat toggles.</li>
          <li>SID duration controls and song number selection for multi-song SID files.</li>
          <li>Optional songlengths support to auto-fill durations when available.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'disks',
    title: 'Disks & Drives',
    icon: Disc,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The Disks page manages drive state and your disk collection.
        </p>
        <p className="font-medium">Find and mount disks:</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Open <strong>Disks</strong>.</li>
          <li>In a Drive card header, tap the <strong>disk icon</strong> to mount/eject.</li>
          <li>Choose a disk from the collection or add one first.</li>
        </ol>
        <p className="font-medium">Add disks to the collection:</p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Tap <strong>Add disks</strong> and pick a source (C64U, local device, or FTP source).</li>
          <li>Use <strong>View all</strong> to search and manage large collections.</li>
          <li>Disk entries show size, date, and allow rename or delete actions.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'disk-swapping',
    title: 'Swapping Disks',
    icon: Disc,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Disk swapping is designed for multi-disk titles.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Set group</strong> assigns disks to a rotation group.</li>
          <li>Use the drive-row rotate arrows to cycle disks in the group.</li>
          <li>Use the header <strong>disk icon</strong> to open mount/eject actions.</li>
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
          Config exposes all C64U categories and items. Use search to find settings quickly.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Changes apply immediately to the device.</li>
          <li>Use Home → <strong>Save</strong> to persist changes to flash.</li>
          <li>Audio Mixer includes SID socket and UltiSID controls with solo support.</li>
        </ul>
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
          Settings controls connection details, appearance, and advanced behavior.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Connection</strong> stores host/IP and password.</li>
          <li><strong>Appearance</strong> switches between light, dark, and system themes.</li>
          <li><strong>Play</strong> options include playlist preview limits and HVSC enablement.</li>
          <li><strong>Device safety</strong> guards concurrency and retry behavior.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    icon: Activity,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Diagnostics helps you inspect activity and share support data. Open it from Settings or the header activity
          indicator.
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>Actions</strong> summarizes user operations with REST/FTP counts and outcomes.</li>
          <li><strong>Traces</strong> lists individual REST/FTP requests with timing and status details.</li>
          <li><strong>Logs</strong> captures app logs and device communication events.</li>
          <li><strong>Errors</strong> collects error reports with context for debugging.</li>
        </ul>
        <p className="text-muted-foreground">
          Use the per-tab filter to narrow results, <strong>Clear</strong> to reset local logs, and <strong>Share</strong> to
          export a diagnostic bundle.
        </p>
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
      <AppBar title="Docs" subtitle="How to use this app" />

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
