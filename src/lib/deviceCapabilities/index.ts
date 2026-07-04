/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export {
  deriveDeviceCapabilities,
  detectStreamingFromConfig,
  clearMachineInputCapabilityCacheForTests,
  probeMachineInputCapability,
  supportsMachineInput,
  supportsMenuInput,
  supportsPowerCycle,
  supportsStreaming,
} from "@/lib/deviceCapabilities/capabilityModel";
export type {
  CapabilitySource,
  DeviceCapabilities,
  DeviceCapabilityInput,
  DeviceFamily,
  MachineInputCapabilityProbeResult,
  MachineInputCapabilityStatus,
} from "@/lib/deviceCapabilities/capabilityModel";
