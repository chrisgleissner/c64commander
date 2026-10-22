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
                (error !is FtpListRefusedException && timeoutMessagePattern.containsMatchIn(error.message ?: "")) ||
                (error is SocketException && !isFtpConnectionRefused(error))

/** The message reported for a failed operation: timeouts are named as such, a refused folder keeps its reply. */
internal fun ftpFailureMessage(
        operation: String,
        error: Exception,
        connectTimeoutMs: Int,
        transferTimeoutMs: Int,
        timeoutMessagePattern: Regex
): String {
  val message = error.message ?: "FTP $operation failed"
  val timedOut =
          error is SocketTimeoutException ||
                  (error !is FtpListRefusedException && timeoutMessagePattern.containsMatchIn(message))
  return if (timedOut) {
    "FTP $operation timed out after connect ${connectTimeoutMs}ms / transfer ${transferTimeoutMs}ms"
  } else {
    message
  }
}

/** How many folders in a row may be refused before the walk gives up. */
internal const val maxConsecutiveRefusals = 2

internal enum class WalkStop {
  NONE,
  LOST,
  REFUSED,
}

/** Decides, folder by folder, whether a recursive listing should go on. */
internal class WalkFailureTracker(private val timeoutMessagePattern: Regex) {
  private var consecutiveRefusals = 0

  fun listed() {
    consecutiveRefusals = 0
  }

  fun failed(error: Exception): WalkStop {
    consecutiveRefusals = if (isFtpConnectionRefused(error)) consecutiveRefusals + 1 else 0
    return when {
      isFtpConnectionLost(error, timeoutMessagePattern) -> WalkStop.LOST
      consecutiveRefusals >= maxConsecutiveRefusals -> WalkStop.REFUSED
      else -> WalkStop.NONE
    }
  }
}

/** The NLST fallback failed; carries the cause so the folder can be reported as skipped. */
internal class NameListingFailedException(cause: Exception) : Exception(cause.message, cause)

class FtpListRefusedException(path: String, code: Int, reply: String) :
        java.io.IOException("FTP LIST $path refused ($code): $reply")
