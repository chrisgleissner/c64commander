/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Failures to turn a host name into an address, as each platform words them. A bare `dns` is not matched, because
 * host names such as c64.ddns.net contain it and a refused host would then be reported as a DNS failure.
 */
const DNS_FAILURE_PATTERN =
  /\(dns\)|\bdns[ _:-]*(?:lookup|resolution|resolve|error|failure|failed|query|server|probe|no such host)|err_name_not_resolved|name or service not known|unknownhostexception|unknown host|unable to resolve host|no such host|enotfound|ename_not_found|eai_again/i;

export const isDnsFailureMessage = (message: string): boolean => DNS_FAILURE_PATTERN.test(message);
