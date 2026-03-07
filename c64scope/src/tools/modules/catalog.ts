import { caseCatalog } from "../../catalog.js";
import { defineToolModule } from "../types.js";
import { jsonResult } from "../responses.js";

export const catalogModule = defineToolModule({
    domain: "scope_catalog",
    summary: "Catalog surfaces for built-in cases.",
    tools: [
        {
            name: "scope_catalog.list_cases",
            description: "List the built-in case catalog currently available to c64scope.",
            inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
            async execute() {
                return jsonResult({
                    ok: true,
                    runId: "scope-catalog",
                    timestamp: new Date().toISOString(),
                    data: {
                        cases: caseCatalog,
                    },
                });
            },
        },
    ],
});
