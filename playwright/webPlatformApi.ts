/**
 * Probe for the web-platform HTTP contract that `webPlatformAuth.spec.ts` exercises.
 *
 * That spec runs in exactly one place: the `Run web-platform Playwright checks` step of
 * `.github/workflows/web.yaml`, against the Docker container it just started. Every endpoint it
 * needs is therefore always present, so a missing endpoint is a regression rather than an
 * unsupported runtime, and the spec must fail instead of skipping. `vite preview`, the default
 * Playwright web server, answers any unknown path with the SPA shell and a 200, which is why the
 * probe checks the payload shape and not just the status code.
 */

export type ProbeResponse = {
  status: () => number;
  headers: () => Record<string, string>;
  json: () => Promise<unknown>;
};

export type ProbeGet = (url: string) => Promise<ProbeResponse>;

export const WEB_PLATFORM_SETUP_HINT =
  "This spec needs the web-platform server on the Playwright base URL. CI starts the Docker image " +
  "and runs it with PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_PORT=18080; see the " +
  '"Run web-platform Playwright checks" step in .github/workflows/web.yaml.';

/**
 * Returns `null` when the server behind `get` is the web-platform server, and a diagnostic
 * sentence naming the observed response when it is not.
 */
export const describeWebPlatformApi = async (get: ProbeGet): Promise<string | null> => {
  let response: ProbeResponse;
  try {
    response = await get("/auth/status");
  } catch (error) {
    return `GET /auth/status could not be reached: ${String(error)}`;
  }

  const status = response.status();
  if (status !== 200) {
    return `GET /auth/status answered ${status}, expected 200.`;
  }

  const contentType = response.headers()["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    return `GET /auth/status answered with content-type "${contentType}", expected application/json. A static preview server answers every path with the SPA shell.`;
  }

  let payload: { requiresLogin?: unknown; authenticated?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    return `GET /auth/status returned a body that is not JSON: ${String(error)}`;
  }

  if (typeof payload.requiresLogin !== "boolean" || typeof payload.authenticated !== "boolean") {
    return `GET /auth/status returned ${JSON.stringify(payload)}, expected boolean requiresLogin and authenticated fields.`;
  }

  return null;
};

/**
 * Throws when the server behind `get` is not the web-platform server. Callers must not turn this
 * into a `test.skip`: a skipped test leaves the run green with the whole auth and proxy contract
 * unverified.
 */
export const requireWebPlatformApi = async (get: ProbeGet): Promise<void> => {
  const problem = await describeWebPlatformApi(get);
  if (problem !== null) {
    throw new Error(`Web platform API is not serving the Playwright base URL. ${problem} ${WEB_PLATFORM_SETUP_HINT}`);
  }
};
