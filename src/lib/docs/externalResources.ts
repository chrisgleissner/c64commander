/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { variant } from "@/generated/variant";

export type ExternalResourceLink = {
  id: string;
  label: string;
  href: string;
  testId: string;
};

/**
 * The keypad edition runs on a phone whose launcher accepts a link and shows nothing: tapping one leaves the
 * app in front with no page. Its screens therefore show an address as plain text where one is worth
 * reading, and no other link.
 */
export const externalLinksOpen = (variantId: string = variant.id): boolean => variantId !== "c64u-remote";

const defaultDocsExternalResourceLinks: readonly ExternalResourceLink[] = [
  {
    id: "ultimate-docs",
    label: "Ultimate Documentation",
    href: "https://1541u-documentation.readthedocs.io/",
    testId: "docs-external-resource-docs",
  },
  {
    id: "rest-api",
    label: "REST API Reference",
    href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
    testId: "docs-external-resource-api",
  },
  {
    id: "ultimate-site",
    label: "Ultimate 64 Official Site",
    href: "https://ultimate64.com/",
    testId: "docs-external-resource-site",
  },
];

const defaultSettingsDocumentationLink: ExternalResourceLink = {
  id: "rest-api",
  label: "Ultimate REST API documentation",
  href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
  testId: "settings-about-rest-api-docs",
};

export function getDocsExternalResourceLinks(variantId: string = variant.id): readonly ExternalResourceLink[] {
  return externalLinksOpen(variantId) ? defaultDocsExternalResourceLinks : [];
}

export function getSettingsDocumentationLink(variantId: string = variant.id): ExternalResourceLink | null {
  return externalLinksOpen(variantId) ? defaultSettingsDocumentationLink : null;
}
