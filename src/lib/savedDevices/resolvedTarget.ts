import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import type { SavedDevice } from "@/lib/savedDevices/store";

/**
 * Build the runtime device host (`host[:port]`) for a saved device.
 *
 * Hostnames are passed through verbatim and resolved by the platform's own
 * resolver. The app does not perform any custom name resolution; DHCP-aware
 * routers may make the Ultimate firmware hostname reachable through normal LAN
 * DNS.
 */
export const buildSavedDevicePreferredRuntimeHost = (device: Pick<SavedDevice, "host" | "httpPort">) =>
  buildDeviceHostWithHttpPort(device.host, device.httpPort);
