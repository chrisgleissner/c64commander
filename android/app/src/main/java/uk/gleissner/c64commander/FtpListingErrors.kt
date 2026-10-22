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

/** The firmware refused a connection: it may be out of sockets rather than gone. */
internal fun isFtpConnectionRefused(error: Exception) =
        error is SocketException && error.message?.contains("refused", ignoreCase = true) == true

/** A timeout (also one that only says so in its message), a closed control connection, or a socket that broke. */
internal fun isFtpConnectionLost(error: Exception, timeoutMessagePattern: Regex) =
        error is SocketTimeoutException ||
                error is FTPConnectionClosedException ||
                timeoutMessagePattern.containsMatchIn(error.message ?: "") ||
                (error is SocketException && !isFtpConnectionRefused(error))

/** How many folders in a row may be refused before the walk gives up. */
internal const val maxConsecutiveRefusals = 2

/** The NLST fallback failed; carries the cause so the folder can be reported as skipped. */
internal class NameListingFailedException(cause: Exception) : Exception(cause.message, cause)
