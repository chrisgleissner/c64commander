import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  ExternalLink, 
  Terminal, 
  Wifi, 
  Settings, 
  HardDrive,
  Play,
  Cpu,
  Volume2
} from 'lucide-react';

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
    title: 'Home Dashboard',
    icon: Terminal,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The home screen shows your device info and provides quick machine controls:
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
      </div>
    ),
  },
  {
    id: 'quick-settings',
    title: 'Quick Settings',
    icon: Cpu,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Quick access to the most commonly used settings:
        </p>
        <div className="space-y-2">
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">Video (VIC)</p>
            <p className="text-xs text-muted-foreground">
              System mode (PAL/NTSC), HDMI settings, palette
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">Audio (SID)</p>
            <p className="text-xs text-muted-foreground">
              Volume and pan for all audio sources
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">SID Configuration</p>
            <p className="text-xs text-muted-foreground">
              UltiSID filter curves, resonance, combined waveforms
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">CPU Settings</p>
            <p className="text-xs text-muted-foreground">
              CPU speed (1-48 MHz), turbo control, badline timing
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">Drives A & B</p>
            <p className="text-xs text-muted-foreground">
              Drive type, bus ID, ROM selection
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'config-browser',
    title: 'Configuration Browser',
    icon: Settings,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          Browse and modify <strong>all</strong> configuration settings on your C64U.
          Settings are auto-discovered from the device at runtime.
        </p>
        <p className="font-medium">Categories include:</p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Audio Mixer - Volume and pan controls</li>
          <li>SID Configuration - Socket and UltiSID settings</li>
          <li>U64 Specific - Video mode, CPU speed, features</li>
          <li>C64 and Cartridge - ROMs, REU, cartridge</li>
          <li>Network & WiFi - Connectivity settings</li>
          <li>Drive A & B - Floppy emulation settings</li>
          <li>...and more</li>
        </ul>
        <p className="text-muted-foreground">
          Tap any category to expand it and modify settings.
          Changes are applied immediately but not saved to flash automatically.
        </p>
      </div>
    ),
  },
  {
    id: 'drives',
    title: 'Drive Control',
    icon: HardDrive,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The C64U supports two virtual floppy drives (A and B), each supporting:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>1541</strong> - Standard C64 drive</li>
          <li><strong>1571</strong> - C128 double-sided drive</li>
          <li><strong>1581</strong> - 3.5" 800KB drive</li>
        </ul>
        <p className="font-medium">Drive Settings:</p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Bus ID (8-11)</li>
          <li>ROM file selection</li>
          <li>Extra RAM enable</li>
          <li>Disk swap delay</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'sid',
    title: 'SID Audio',
    icon: Volume2,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The Ultimate 64 has 2 physical SID sockets plus 2 UltiSIDs (FPGA emulation).
        </p>
        <div className="space-y-2">
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">Physical Sockets</p>
            <p className="text-xs text-muted-foreground">
              Socket 1 & 2 - For real 6581/8580 SID chips.
              Auto-detected, enable/disable, volume control.
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="font-medium">UltiSID 1 & 2</p>
            <p className="text-xs text-muted-foreground">
              FPGA emulated SIDs with configurable:
              Filter curve, resonance, combined waveforms, digis level.
            </p>
          </div>
        </div>
        <p className="text-muted-foreground">
          Volume ranges from OFF to +6 dB in 1dB steps.
          Pan control allows stereo positioning.
        </p>
      </div>
    ),
  },
  {
    id: 'runners',
    title: 'Running Programs',
    icon: Play,
    content: (
      <div className="space-y-3 text-sm">
        <p>
          The REST API supports running programs directly:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li><strong>SID Play</strong> - Play SID music files</li>
          <li><strong>MOD Play</strong> - Play Amiga MOD files</li>
          <li><strong>Load PRG</strong> - DMA load a program</li>
          <li><strong>Run PRG</strong> - Load and run a program</li>
          <li><strong>Run CRT</strong> - Run a cartridge image</li>
        </ul>
        <p className="text-muted-foreground">
          Programs can be loaded from the Ultimate's filesystem or uploaded directly.
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
        onClick={() => setIsOpen(!isOpen)}
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
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <h1 className="c64-header text-xl">Documentation</h1>
          <p className="text-xs text-muted-foreground mt-1">
            How to use this app
          </p>
        </div>
      </header>

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
