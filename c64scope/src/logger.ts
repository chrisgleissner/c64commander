export interface ScopeLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

function format(message: string, details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) {
    return message;
  }

  try {
    return `${message} ${JSON.stringify(details)}`;
  } catch {
    return message;
  }
}

export function createLogger(scope: string): ScopeLogger {
  return {
    debug(message, details) {
      if (process.env.C64SCOPE_DEBUG === "1") {
        console.error(`[${scope}] ${format(message, details)}`);
      }
    },
    info(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
    warn(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
    error(message, details) {
      console.error(`[${scope}] ${format(message, details)}`);
    },
  };
}
