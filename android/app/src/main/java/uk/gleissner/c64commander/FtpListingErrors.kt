/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.SocketException
import java.net.SocketTimeoutException
import org.apache.commons.net.ftp.FTPConnectionClosedException

/** A timeout, a closed control connection, or a socket that broke; a refused connection is not one. */
internal fun isFtpConnectionLost(error: Exception) =
        error is SocketTimeoutException ||
                error is FTPConnectionClosedException ||
                (error is SocketException && error.message?.contains("refused", ignoreCase = true) != true)

/** The NLST fallback failed; carries the cause so the folder can be reported as skipped. */
internal class NameListingFailedException(cause: Exception) : Exception(cause.message, cause)
