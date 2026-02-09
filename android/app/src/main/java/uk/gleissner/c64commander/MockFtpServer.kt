/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class MockFtpServer(
  private val rootDir: File,
  private val password: String?,
) {
  private val executor = Executors.newCachedThreadPool()
  private val sockets = Collections.synchronizedSet(mutableSetOf<Socket>())
  private var serverSocket: ServerSocket? = null
  @Volatile private var running = false
  var port: Int = 0
    private set
  private companion object {
    const val LOG_TAG = "MockFtpServer"
  }

  fun start(preferredPort: Int? = null): Int {
    if (running) return port
    val address = InetAddress.getByName("127.0.0.1")
    val resolvedPort = preferredPort?.takeIf { it > 1024 } ?: 0
    serverSocket = ServerSocket(resolvedPort, 50, address)
    port = serverSocket?.localPort ?: 0
    running = true
    executor.execute { acceptLoop() }
    return port
  }

  fun stop() {
    running = false
    try {
      serverSocket?.close()
    } catch (error: Exception) {
      Log.w(LOG_TAG, "Failed to close server socket", error)
    }
    val snapshot = synchronized(sockets) { sockets.toList() }
    snapshot.forEach { socket ->
      try {
        socket.close()
      } catch (error: Exception) {
        Log.w(LOG_TAG, "Failed to close client socket", error)
      }
    }
    sockets.clear()
    executor.shutdownNow()
  }

  private fun acceptLoop() {
    while (running) {
      val socket = try {
        serverSocket?.accept()
      } catch (error: Exception) {
        Log.w(LOG_TAG, "Accept loop failed", error)
        null
      }
      if (socket != null) {
        sockets.add(socket)
        executor.execute { handleClient(socket) }
      }
    }
  }

  private fun handleClient(socket: Socket) {
    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
    val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
    val session = FtpSession(rootDir, password, writer)
    session.send("220 Mock C64U FTP ready")

    try {
      while (running && !socket.isClosed) {
        val line = reader.readLine() ?: break
        val trimmed = line.trim()
        if (trimmed.isEmpty()) continue
        session.handleCommand(trimmed)
        if (session.isClosed) break
      }
    } catch (error: Exception) {
      Log.w(LOG_TAG, "FTP session error", error)
    } finally {
      try {
        socket.close()
      } catch (error: Exception) {
        Log.w(LOG_TAG, "Failed to close FTP socket", error)
      }
      sockets.remove(socket)
      session.cleanup()
    }
  }

  private class FtpSession(
    private val rootDir: File,
    private val password: String?,
    private val writer: BufferedWriter,
  ) {
    private var cwd: String = "/"
    private var loggedIn = false
    private var passiveServer: ServerSocket? = null
    var isClosed: Boolean = false
      private set

    fun send(message: String) {
      writer.write("$message\r\n")
      writer.flush()
    }

    fun cleanup() {
      try {
        passiveServer?.close()
      } catch (error: Exception) {
        Log.w(LOG_TAG, "Failed to close passive server", error)
      }
      passiveServer = null
    }

    fun handleCommand(rawLine: String) {
      val parts = rawLine.split(" ", limit = 2)
      val command = parts[0].uppercase(Locale.ROOT)
      val argument = parts.getOrNull(1)

      when (command) {
        "USER" -> {
          send("331 Password required")
        }
        "PASS" -> {
          if (password.isNullOrBlank() || argument == password) {
            loggedIn = true
            send("230 Login ok")
          } else {
            loggedIn = false
            send("530 FTP login failed")
          }
        }
        "SYST" -> send("215 UNIX Type: L8")
        "FEAT" -> {
          send("211-Features")
          send("211 End")
        }
        "TYPE" -> send("200 Type set")
        "NOOP" -> send("200 OK")
        "PWD", "XPWD" -> send("257 \"$cwd\" is current directory")
        "CWD" -> {
          if (!requireLogin()) return
          val next = resolvePath(argument ?: "")
          if (isDirectory(next)) {
            cwd = next
            send("250 Directory changed")
          } else {
            send("550 Directory not found")
          }
        }
        "CDUP" -> {
          if (!requireLogin()) return
          val parent = parentPath(cwd)
          if (isDirectory(parent)) {
            cwd = parent
            send("250 Directory changed")
          } else {
            send("550 Directory not found")
          }
        }
        "PASV" -> {
          if (!requireLogin()) return
          openPassive()
        }
        "LIST" -> {
          if (!requireLogin()) return
          val target = argument?.takeIf { it.isNotBlank() }?.let { resolvePath(it) } ?: cwd
          send("150 Opening data connection")
          withDataSocket { dataSocket ->
            writeListing(dataSocket, target, namesOnly = false)
          }
          send("226 Transfer complete")
        }
        "NLST" -> {
          if (!requireLogin()) return
          val target = argument?.takeIf { it.isNotBlank() }?.let { resolvePath(it) } ?: cwd
          send("150 Opening data connection")
          withDataSocket { dataSocket ->
            writeListing(dataSocket, target, namesOnly = true)
          }
          send("226 Transfer complete")
        }
        "RETR" -> {
          if (!requireLogin()) return
          val target = argument?.takeIf { it.isNotBlank() }?.let { resolvePath(it) } ?: ""
          val file = resolveFile(target)
          if (file == null || !file.isFile) {
            send("550 File not found")
            return
          }
          send("150 Opening data connection")
          withDataSocket { dataSocket ->
            file.inputStream().use { input ->
              val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
              val output = dataSocket.getOutputStream()
              while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                output.write(buffer, 0, read)
              }
              output.flush()
            }
          }
          send("226 Transfer complete")
        }
        "QUIT" -> {
          send("221 Goodbye")
          isClosed = true
        }
        else -> send("502 Command not implemented")
      }
    }

    private fun requireLogin(): Boolean {
      if (!loggedIn) {
        send("530 Not logged in")
        return false
      }
      return true
    }

    private fun openPassive() {
      cleanup()
      val address = InetAddress.getByName("127.0.0.1")
      passiveServer = ServerSocket(0, 1, address)
      val port = passiveServer?.localPort ?: 0
      val p1 = port / 256
      val p2 = port % 256
      send("227 Entering Passive Mode (127,0,0,1,$p1,$p2)")
    }

    private fun withDataSocket(block: (Socket) -> Unit) {
      val dataServer = passiveServer
      if (dataServer == null) {
        send("425 Use PASV first")
        return
      }
      val dataSocket = dataServer.accept()
      try {
        block(dataSocket)
      } finally {
        try {
          dataSocket.close()
        } catch (error: Exception) {
          Log.w(LOG_TAG, "Failed to close data socket", error)
        }
        cleanup()
      }
    }

    private fun writeListing(dataSocket: Socket, targetPath: String, namesOnly: Boolean) {
      val out = dataSocket.getOutputStream()
      val file = resolveFile(targetPath)
      val list = if (file == null) emptyList() else if (file.isDirectory) {
        file.listFiles()?.toList() ?: emptyList()
      } else {
        listOf(file)
      }

      val formatter = SimpleDateFormat("MMM dd HH:mm", Locale.US)
      list.sortedBy { it.name }.forEach { entry ->
        if (namesOnly) {
          out.write("${entry.name}\r\n".toByteArray())
        } else {
          val perms = if (entry.isDirectory) "drwxr-xr-x" else "-rw-r--r--"
          val size = if (entry.isDirectory) 0 else entry.length()
          val date = formatter.format(Date(entry.lastModified()))
          val line = "$perms 1 user group $size $date ${entry.name}\r\n"
          out.write(line.toByteArray())
        }
      }
      out.flush()
    }

    private fun resolvePath(raw: String): String {
      val base = if (raw.startsWith("/")) raw else if (cwd.endsWith("/")) "$cwd$raw" else "$cwd/$raw"
      val parts = base.split("/").filter { it.isNotBlank() && it != "." }
      val normalized = mutableListOf<String>()
      parts.forEach { part ->
        if (part == "..") {
          if (normalized.isNotEmpty()) normalized.removeAt(normalized.size - 1)
        } else {
          normalized.add(part)
        }
      }
      return if (normalized.isEmpty()) "/" else "/" + normalized.joinToString("/")
    }

    private fun parentPath(path: String): String {
      if (path == "/") return "/"
      val trimmed = path.removeSuffix("/")
      val idx = trimmed.lastIndexOf('/')
      if (idx <= 0) return "/"
      return trimmed.substring(0, idx)
    }

    private fun resolveFile(path: String): File? {
      val normalized = resolvePath(path)
      val relative = normalized.removePrefix("/")
      val target = if (relative.isBlank()) rootDir else File(rootDir, relative)
      val canonicalRoot = rootDir.canonicalFile
      val canonicalTarget = target.canonicalFile
      return if (canonicalTarget.path.startsWith(canonicalRoot.path)) canonicalTarget else null
    }

    private fun isDirectory(path: String): Boolean {
      val file = resolveFile(path)
      return file != null && file.exists() && file.isDirectory
    }
  }
}
