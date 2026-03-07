export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: PromptArgument[];
  render: (args: Record<string, string>) => string;
  requiredResources?: string[];
  tools?: string[];
}

export const prompts: PromptDefinition[] = [
  {
    name: "agentic_physical_case",
    title: "Agentic Physical Case Runner",
    description: "Bootstrap prompt for running a case through the three-peer-server architecture.",
    requiredResources: ["c64scope://catalog/cases", "c64scope://catalog/playbooks"],
    tools: ["scope_session.start_session", "scope_session.record_step", "scope_session.finalize_session"],
    arguments: [
      {
        name: "caseId",
        description: "The case identifier from the c64scope case catalog.",
        required: true,
      },
    ],
    render: ({ caseId }) =>
      [
        "Use only the approved peer-server model: mobile controller, c64bridge, and c64scope.",
        `Load case metadata for ${caseId}.`,
        "Start a c64scope session before any signal-sensitive action.",
        "Record every meaningful controller or c64bridge action with scope_session.record_step.",
        "Use app-first control and rely on non-A/V evidence when it is stronger than signal evidence.",
        "Finalize the run as pass, fail, or inconclusive with deterministic artifacts.",
      ].join("\n"),
  },
];
