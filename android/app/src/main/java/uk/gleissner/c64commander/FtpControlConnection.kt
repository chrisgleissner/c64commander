/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import org.apache.commons.net.ftp.FTPClient

private const val FTP_CONNECT_LOG_TAG = "FtpClientPlugin"

/**
 * Opens the FTP control connection. A literal IP address is connected exactly as given; a host
 * name is tried at every address it resolves to, IPv4 first, within [connectTimeoutMs] overall.
 */
internal fun connectFtpControl(
        client: FTPClient,
        host: String,
        port: Int,
        connectTimeoutMs: Int,
        resolver: HostAddressResolver,
        context: () -> Context?,
) {
  if (HostAddressConnector.isIpLiteral(host)) {
    client.connect(host, port)
    return
  }
  val addresses = HostAddressConnector.resolveIpv4First(resolver, host)
  try {
    val (address, _) =
            HostAddressConnector.connectFirstReachable(
                    addresses,
                    connectTimeoutMs,
                    attempt = { address, attemptTimeoutMs ->
                      client.connectTimeout = attemptTimeoutMs
                      client.defaultTimeout = attemptTimeoutMs
                      client.connect(address, port)
                    },
                    onAttemptFailed = { failure ->
                      resetAfterFailedAttempt(client, host, context)
                      if (addresses.size > 1) {
                        AppLogger.warn(
                                context(),
                                FTP_CONNECT_LOG_TAG,
                                "FTP connect to $host via ${failure.address.hostAddress}:$port failed within " +
                                        "${failure.timeoutMs}ms of ${connectTimeoutMs}ms (${addresses.size} addresses resolved)",
                                "FtpClientPlugin",
                                failure.error,
                        )
                      }
                    },
            )
    AppLogger.debug(
            context(),
            FTP_CONNECT_LOG_TAG,
            "FTP connected to $host via ${address.hostAddress}:$port (${addresses.size} addresses resolved)",
            "FtpClientPlugin",
    )
  } finally {
    // The passive data connection reuses connectTimeout, so it must not keep one attempt's share.
    client.connectTimeout = connectTimeoutMs
    client.defaultTimeout = connectTimeoutMs
  }
}

private fun resetAfterFailedAttempt(client: FTPClient, host: String, context: () -> Context?) {
  try {
    client.disconnect()
  } catch (error: Exception) {
    AppLogger.warn(
            context(),
            FTP_CONNECT_LOG_TAG,
            "Failed to reset the FTP client after a failed connect attempt to $host",
            "FtpClientPlugin",
            error,
    )
  }
}
