import { defineToolModule } from "../types.js";
import { jsonResult } from "../responses.js";

export const labModule = defineToolModule({
  domain: "scope_lab",
  summary: "Lab readiness and peer-server health checks.",
  tools: [
    {
      name: "scope_lab.get_lab_state",
      description: "Return the current c64scope lab-health view for peer-server readiness.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult({
          ok: true,
          runId: "scope-lab",
          timestamp: new Date().toISOString(),
          data: {
            mobileControllerDevices: process.env.C64SCOPE_CONNECTED_DEVICES?.split(",").filter(Boolean) ?? [],
            c64bridgeStatus: process.env.C64SCOPE_C64BRIDGE_STATUS ?? "unknown",
            captureStatus: process.env.C64SCOPE_CAPTURE_STATUS ?? "unconfigured",
            notes: "This skeleton reports environment-sourced readiness only.",
          },
        });
      },
    },
  ],
});
