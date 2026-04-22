import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

type TasksConfig = {
  presentation?: {
    reveal?: string;
    revealProblems?: string;
    focus?: boolean;
    showReuseMessage?: boolean;
    panel?: string;
    clear?: boolean;
  };
};

const tasksConfigPath = path.resolve(process.cwd(), ".vscode/tasks.json");

const readTasksConfig = (): TasksConfig => JSON.parse(readFileSync(tasksConfigPath, "utf8")) as TasksConfig;

describe("VS Code task presentation contracts", () => {
  it("keeps task terminals quiet unless the user explicitly opens them", () => {
    const tasksConfig = readTasksConfig();

    expect(tasksConfig.presentation).toMatchObject({
      reveal: "never",
      revealProblems: "never",
      focus: false,
      showReuseMessage: false,
      panel: "dedicated",
      clear: false,
    });
  });
});
