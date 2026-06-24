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

export const C64U_USER_GUIDE_URL =
  "https://downloads.commodore-international.com/documentation/C64U/c64u-user-guide-1st-edition.pdf";

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

const c64uRemoteDocsExternalResourceLinks: readonly ExternalResourceLink[] = [
  {
    id: "c64u-user-guide",
    label: "C64U User Guide",
    href: C64U_USER_GUIDE_URL,
    testId: "docs-external-resource-c64u-user-guide",
  },
];

const defaultSettingsDocumentationLink: ExternalResourceLink = {
  id: "rest-api",
  label: "Ultimate REST API Documentation",
  href: "https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html",
  testId: "settings-about-rest-api-docs",
};

const c64uRemoteSettingsDocumentationLink: ExternalResourceLink = {
  id: "c64u-user-guide",
  label: "C64U User Guide",
  href: C64U_USER_GUIDE_URL,
  testId: "settings-about-c64u-user-guide",
};

export function getDocsExternalResourceLinks(variantId: string = variant.id): readonly ExternalResourceLink[] {
  return variantId === "c64u-remote" ? c64uRemoteDocsExternalResourceLinks : defaultDocsExternalResourceLinks;
}

export function getSettingsDocumentationLink(variantId: string = variant.id): ExternalResourceLink {
  return variantId === "c64u-remote" ? c64uRemoteSettingsDocumentationLink : defaultSettingsDocumentationLink;
}
