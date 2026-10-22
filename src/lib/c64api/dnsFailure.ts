/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Failures to turn a host name into an address, as each platform words them. The letters dns are matched only
 * as the word before a failure noun, never inside a host name (c64.ddns.net, dns-server.local), a path
 * (/Usb0/dns_error.prg) or a device setting (Static DNS: error 400).
 */
const DNS_WORDING =
  /\(dns\)|(?<![\w./-])dns (?:lookup|resolution|resolve|query|server|error|failure|failed)\b|dns_probe_finished|err_name_not_resolved/i;

/** The resolver said it could not answer now, so asking again may work. */
const TEMPORARY_RESOLVER_FAILURE = /eai_again|temporary failure in name resolution/i;

/** The resolver answered that the name does not exist or cannot be resolved here. */
const NAME_NOT_FOUND =
  /name or service not known|unknownhostexception|unknown host|unable to resolve host|cannot resolve|no such host|enotfound|ename_not_found|getaddrinfo|nodename nor servname|server with the specified hostname could not be found/i;

export const isDnsFailureMessage = (message: string): boolean =>
  DNS_WORDING.test(message) || TEMPORARY_RESOLVER_FAILURE.test(message) || NAME_NOT_FOUND.test(message);

/** Failures that justify a retry and count as a connectivity problem; a name that does not exist does not. */
export const isTransientDnsFailureMessage = (message: string): boolean =>
  DNS_WORDING.test(message) || TEMPORARY_RESOLVER_FAILURE.test(message);
