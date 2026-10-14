/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.net.InetAddress
import java.net.Socket
import javax.net.SocketFactory
import org.apache.commons.net.ftp.FTPClient

/**
 * An [FTPClient] whose [disconnect] also closes every socket it opened, data connections included.
 *
 * commons-net connects the passive data socket before it sends RETR or LIST, and drops it without
 * closing it when that command then fails, for example when the reply times out. Nothing else holds
 * the socket, so it stayed open until the garbage collector found it.
 */
internal class SocketClosingFtpClient : FTPClient() {
  private val opened = mutableListOf<Socket>()

  init {
    setSocketFactory(TrackingSocketFactory())
  }

  override fun disconnect() {
    try {
      super.disconnect()
    } finally {
      closeOpenedSockets()
    }
  }

  private fun closeOpenedSockets() {
    val sockets = synchronized(opened) { opened.toList().also { opened.clear() } }
    sockets.forEach { socket ->
      try {
        socket.close()
      } catch (error: Exception) {
        Log.w(TAG, "Failed to close FTP socket ${socket.localPort} -> ${socket.remoteSocketAddress}", error)
      }
    }
  }

  private inner class TrackingSocketFactory : SocketFactory() {
    private val platform = SocketFactory.getDefault()

    private fun track(socket: Socket): Socket = socket.also { synchronized(opened) { opened += it } }

    override fun createSocket(): Socket = track(platform.createSocket())

    override fun createSocket(host: String, port: Int): Socket = track(platform.createSocket(host, port))

    override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
        track(platform.createSocket(host, port, localHost, localPort))

    override fun createSocket(host: InetAddress, port: Int): Socket = track(platform.createSocket(host, port))

    override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
        track(platform.createSocket(address, port, localAddress, localPort))
  }

  private companion object {
    const val TAG = "FtpClientPlugin"
  }
}
