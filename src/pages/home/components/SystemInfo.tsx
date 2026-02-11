import { useState } from 'react';
import { motion } from 'framer-motion';
import { useC64Connection } from '@/hooks/useC64Connection';
import { getBuildInfo } from '@/lib/buildInfo';

export function SystemInfo() {
    const [expanded, setExpanded] = useState(false);
    const { status } = useC64Connection();
    const buildInfo = getBuildInfo();

    return (
        <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="w-full text-left px-1 py-1"
            aria-expanded={expanded}
            data-testid="home-system-info"
            data-section-label="System info"
        >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                <span className="text-muted-foreground">App</span>
                <span className="font-semibold text-foreground" data-testid="home-system-version">
                    {buildInfo.versionLabel || '—'}
                </span>
                <span className="text-muted-foreground">Device</span>
                <span className="font-semibold text-foreground" data-testid="home-system-device">
                    {status.deviceInfo?.hostname || status.deviceInfo?.product || '—'}
                </span>
                <span className="text-muted-foreground">Firmware</span>
                <span className="font-semibold text-foreground" data-testid="home-system-firmware">
                    {status.deviceInfo?.firmware_version || '—'}
                </span>
            </div>
            {expanded && (
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <span>Git</span>
                        <span className="font-semibold text-foreground" data-testid="home-system-git">
                            {buildInfo.gitShaShort || '—'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span>Build</span>
                        <span className="font-semibold text-foreground" data-testid="home-system-build-time">
                            {buildInfo.buildTimeUtc}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span>FPGA</span>
                        <span className="font-semibold text-foreground" data-testid="home-system-fpga">
                            {status.deviceInfo?.fpga_version || '—'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span>Core</span>
                        <span className="font-semibold text-foreground" data-testid="home-system-core">
                            {status.deviceInfo?.core_version || '—'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span>Core ID</span>
                        <span className="font-semibold text-foreground" data-testid="home-system-core-id">
                            {status.deviceInfo?.unique_id || '—'}
                        </span>
                    </div>
                </div>
            )}
        </motion.button>
    );
}
