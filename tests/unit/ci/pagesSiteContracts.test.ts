import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * The privacy policy was published as Markdown and converted to HTML by Jekyll.
 * When the site moved to docs/site and switched to a workflow build, which
 * serves files verbatim, privacy-policy.html began returning 404 and stayed
 * that way unnoticed. These tests pin the properties that broke.
 */

const repoRoot = process.cwd();
const workflowPath = path.join(repoRoot, ".github/workflows/pages.yaml");
const workflowSource = readFileSync(workflowPath, "utf8");

const workflow = yaml.load(workflowSource) as {
  on: { push: { paths: string[] }; schedule?: { cron: string }[] };
  jobs: Record<string, { steps?: { uses?: string; with?: Record<string, string> }[] }>;
};

/**
 * Read the published directory out of the workflow rather than hard-coding it.
 * The regression started with docs/ moving to docs/site/, so a test that named
 * the directory itself would have moved with the files and gone on passing.
 */
const publishedRelative = (() => {
  const upload = workflow.jobs.deploy.steps?.find((step) => step.uses?.includes("upload-pages-artifact"));
  const uploadPath = upload?.with?.path;
  expect(uploadPath, "the deploy job must upload a directory to Pages").toBeTruthy();
  return uploadPath as string;
})();
const publishedRoot = path.join(repoRoot, publishedRelative);

/** Every URL the site is expected to answer on, as a path below the published root. */
const PROMISED_PAGES = ["index.html", "privacy-policy.html"];

const readPage = (page: string) => readFileSync(path.join(publishedRoot, page), "utf8");

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [path.relative(publishedRoot, full)];
  });

describe("the published site", () => {
  it("publishes the directory that actually holds the pages", () => {
    expect(existsSync(publishedRoot)).toBe(true);
    for (const page of PROMISED_PAGES) {
      expect(existsSync(path.join(publishedRoot, page)), `${page} is not in the published directory`).toBe(true);
    }
  });

  it("serves each promised page as HTML, because a workflow build converts nothing", () => {
    for (const page of PROMISED_PAGES) {
      expect(page.endsWith(".html"), `${page} must be an .html file`).toBe(true);
      expect(readPage(page).trimStart().toLowerCase()).toMatch(/^<!doctype html/);

      // The Markdown original returning under the same name would put the site
      // straight back where it started.
      const markdownTwin = page.replace(/\.html$/, ".md");
      expect(existsSync(path.join(publishedRoot, markdownTwin)), `${markdownTwin} would shadow ${page}`).toBe(false);
    }
  });

  it("keeps Markdown out of any directory that is meant to answer as a URL", () => {
    // index.md is the specific shape that fails: nothing converts it, so the
    // directory URL above it returns 404. Markdown that is plainly a data
    // sample, such as the telemetry example, is a file rather than a page.
    const published = filesUnder(publishedRoot);

    // The filter below is satisfied by an empty walk, so the walk has to prove
    // it read the site: every promised page is a file it must have returned.
    for (const page of PROMISED_PAGES) {
      expect(published, `the walk of ${publishedRelative} did not reach ${page}`).toContain(page);
    }
    expect(published.length, "the walk of the published directory found nothing").toBeGreaterThan(
      PROMISED_PAGES.length,
    );

    const indexMarkdown = published.filter((file) => path.basename(file) === "index.md");
    expect(indexMarkdown, "these would 404 as directory URLs").toEqual([]);
  });

  it("redeploys when a published file changes", () => {
    expect(workflow.on.push.paths).toContain(`${publishedRelative}/**`);
  });

  it("probes the live site on a schedule, so it cannot rot between changes", () => {
    expect(workflow.on.schedule?.length ?? 0).toBeGreaterThan(0);
    expect(workflow.jobs.verify, "the workflow has no job that checks the published URLs").toBeTruthy();
  });

  it("checks every promised page after deploying", () => {
    for (const page of PROMISED_PAGES) {
      // index.html answers as the bare directory URL.
      const url = page === "index.html" ? '"/"' : `"/${page}"`;
      expect(workflowSource, `the live check does not request ${page}`).toContain(url);
    }
  });

  it("keeps the pages self-contained, so reading them tells no one anything", () => {
    for (const page of PROMISED_PAGES) {
      const html = readPage(page);

      // Naming the elements and requiring double quotes made the check easy to
      // slip past: a single-quoted img, or one of the several other attributes
      // that fetch a URL, was invisible to it. The rule is instead that the only
      // remote URL a page may carry is the destination of a link the reader
      // chooses to follow. Anything left after the anchors are removed - a src,
      // a stylesheet link, a url() inside the inline style - is fetched on load.
      const remoteLinks = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']?https?:\/\//gi)];
      const withoutAnchors = html.replace(/<a\b[^>]*>/gi, "");
      const fetchedOnLoad = [...withoutAnchors.matchAll(/https?:\/\/[^"'\s>)]+/gi)].map((match) => match[0]);
      expect(fetchedOnLoad, `${page} loads a third-party resource`).toEqual([]);

      // An empty result also means a scan that read nothing. Both pages link
      // out to the repository, so finding no outbound link at all is a defect
      // in this test rather than a property of the page.
      expect(remoteLinks.length, `found no outbound link in ${page}, so the scan read nothing`).toBeGreaterThan(0);

      expect(html, `${page} imports a webfont`).not.toMatch(/@import|fonts\.googleapis\.com/i);
    }
  });

  it("keeps the promised pages linked to each other", () => {
    expect(readPage("index.html")).toContain('href="privacy-policy.html"');
    expect(readPage("privacy-policy.html")).toContain('href="./"');
  });
});

describe("the privacy policy", () => {
  const policy = () => readPage("privacy-policy.html");
  const manifest = () => readFileSync(path.join(repoRoot, "android/app/src/main/AndroidManifest.xml"), "utf8");

  it("says which app and which platform it covers", () => {
    expect(policy()).toContain("C64 Commander");
    expect(policy()).toMatch(/covers the C64 Commander app for Android/i);
  });

  it("names no other edition of the app", () => {
    expect(policy()).not.toMatch(/C64U Remote/i);
  });

  it("keeps the sections a reader and a store reviewer look for", () => {
    const html = policy();
    for (const heading of [
      "What is stored on your device",
      "What is never collected",
      "Every network request the app makes",
      "Permissions",
      "Children",
      "Contact",
    ]) {
      expect(html, `the policy has lost its "${heading}" section`).toContain(`>${heading}<`);
    }
    expect(html).toMatch(/effective \d{1,2} \w+ \d{4}/i);
    expect(html).toContain("mailto:");
  });

  it("describes every permission the app declares", () => {
    const declared = [...manifest().matchAll(/android:name="android\.permission\.([A-Z_]+)"/g)].map(
      (match) => match[1],
    );
    const html = policy().toLowerCase();

    // A permission added to the manifest fails here until the policy explains
    // it, which is the only way the two stay in step. A permission the user is
    // prompted for also has to say so, since the policy used to promise there
    // were none.
    const described: Record<string, string> = {
      INTERNET: "internet",
      CHANGE_WIFI_MULTICAST_STATE: "multicast",
      FOREGROUND_SERVICE: "foreground service",
      FOREGROUND_SERVICE_MEDIA_PLAYBACK: "media playback",
      FOREGROUND_SERVICE_DATA_SYNC: "data sync",
      WAKE_LOCK: "wake lock",
      POST_NOTIFICATIONS: "notifications",
    };
    for (const permission of declared) {
      const phrase = described[permission];
      expect(phrase, `${permission} is declared but the policy does not describe it`).toBeTruthy();
      expect(html, `the policy does not mention ${permission}`).toContain(phrase);
    }

    // The count is stated in the prose, so it has to match the manifest.
    const counted = ["", "one", "two", "three", "four", "five", "six", "seven"][declared.length];
    expect(policy(), `the policy counts the permissions wrong; there are ${declared.length}`).toContain(
      `declares ${counted} Android permissions`,
    );

    // POST_NOTIFICATIONS is prompted for, so the old blanket promise that none
    // of the permissions is one Android asks about must not come back.
    if (declared.includes("POST_NOTIFICATIONS")) {
      expect(policy()).not.toMatch(/none of them is one Android asks you to approve/i);
      expect(html).toContain("the only one android asks you to approve");
    }
  });

  it("claims no permission the app does not hold", () => {
    // The policy tells the reader these are absent, so their absence is a fact
    // the test has to keep true.
    for (const permission of [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "READ_CONTACTS",
      "CAMERA",
      "RECORD_AUDIO",
      "READ_EXTERNAL_STORAGE",
      "READ_MEDIA_IMAGES",
    ]) {
      expect(manifest(), `the policy says the app holds no ${permission}`).not.toContain(
        `android.permission.${permission}`,
      );
    }
  });
});
