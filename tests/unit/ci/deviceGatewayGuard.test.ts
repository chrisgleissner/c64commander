import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const srcRoot = path.join(repoRoot, "src");

const ALLOWED_DIRECT_FETCH_FILES = new Set(["src/lib/c64api.ts", "src/lib/native/ftpClient.web.ts"]);

const ALLOWED_NATIVE_SOCKET_IMPORT_FILES = new Set([
  "src/lib/ftp/ftpClient.ts",
  "src/lib/telnet/telnetClient.ts",
  "src/lib/native/telnetSocket.web.ts",
]);

type Violation = {
  file: string;
  reason: string;
};

const walkFiles = (root: string): string[] => {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

const hasDirectDeviceFetch = (content: string): boolean => {
  if (!/\bfetch\s*\(/.test(content)) {
    return false;
  }

  return /\/v1(?:\/|:)/.test(content);
};

const hasDisallowedNativeSocketImport = (content: string): boolean =>
  /from\s+['"]@\/lib\/native\/(?:telnetSocket|ftpClient)['"]/.test(content);

const findViolations = (files: Array<{ file: string; content: string }>): Violation[] =>
  files.flatMap(({ file, content }) => {
    const violations: Violation[] = [];

    if (hasDirectDeviceFetch(content) && !ALLOWED_DIRECT_FETCH_FILES.has(file)) {
      violations.push({
        file,
        reason: "direct fetch() against /v1 device endpoints must stay inside the REST gateway",
      });
    }

    if (hasDisallowedNativeSocketImport(content) && !ALLOWED_NATIVE_SOCKET_IMPORT_FILES.has(file)) {
      violations.push({
        file,
        reason: "native FTP/Telnet socket imports must stay behind the gateway client modules",
      });
    }

    return violations;
  });

describe("device gateway guard", () => {
  it("keeps direct device endpoint access inside the approved gateway modules", () => {
    const files = walkFiles(srcRoot).map((absolutePath) => ({
      file: path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/"),
      content: fs.readFileSync(absolutePath, "utf8"),
    }));

    expect(findViolations(files)).toEqual([]);
  });

  it("rejects a planted raw device fetch outside the gateway", () => {
    const violations = findViolations([
      {
        file: "src/components/BadProbe.tsx",
        content: `
          export const badProbe = async (baseUrl: string) =>
            fetch(\`\${baseUrl}/v1/info\`, { method: 'GET' });
        `,
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/components/BadProbe.tsx",
        reason: "direct fetch() against /v1 device endpoints must stay inside the REST gateway",
      },
    ]);
  });

  it("rejects a planted native socket import outside the gateway", () => {
    const violations = findViolations([
      {
        file: "src/components/BadTelnet.ts",
        content: `import { TelnetSocket } from '@/lib/native/telnetSocket';`,
      },
    ]);

    expect(violations).toEqual([
      {
        file: "src/components/BadTelnet.ts",
        reason: "native FTP/Telnet socket imports must stay behind the gateway client modules",
      },
    ]);
  });
});
