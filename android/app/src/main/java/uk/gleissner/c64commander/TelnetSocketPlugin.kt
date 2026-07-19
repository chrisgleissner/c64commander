/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@CapacitorPlugin(name = "TelnetSocket")
class TelnetSocketPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val logTag = "TelnetSocketPlugin"
  private val defaultTimeoutMs = 5_000
  private val defaultReadTimeoutMs = 500
  private val readDrainSliceTimeoutMs = 25

  internal var socketFactory: () -> Socket = { Socket() }
  internal var runTask: (Runnable) -> Unit = { runnable -> executor.execute(runnable) }

  // Written only on the single-thread executor, but isConnected() (below) reads
  // them synchronously on the Capacitor plugin thread with no other synchronization -
  // @Volatile establishes the happens-before edge so a write on the executor thread
  // (e.g. connect() assigning `socket` right before resolving its call) is reliably
  // visible to isConnected() on the plugin thread afterward, instead of risking a
  // stale/torn read of a plain var across threads.
  @Volatile private var socket: Socket? = null
  @Volatile private var inputStream: InputStream? = null
  @Volatile private var outputStream: OutputStream? = null

  @PluginMethod
  fun connect(call: PluginCall) {
    val host = call.getString("host")
    if (host.isNullOrBlank()) {
      call.reject("host is required")
      return
    }
    val port = call.getInt("port") ?: 23
    val timeoutMs = call.getInt("timeoutMs") ?: defaultTimeoutMs

    runTask(
            Runnable {
              try {
                // Close existing connection
                closeSocket()

                val sock = socketFactory()
                sock.connect(InetSocketAddress(host, port), timeoutMs)
                sock.soTimeout = defaultReadTimeoutMs
                socket = sock
                inputStream = sock.getInputStream()
                outputStream = sock.getOutputStream()

                AppLogger.info(
                        context,
                        logTag,
                        "Telnet connected to $host:$port",
                        "TelnetSocketPlugin",
                )
                call.resolve(JSObject())
              } catch (error: Exception) {
                AppLogger.error(
                        context,
                        logTag,
                        "Telnet connect failed: ${error.message}",
                        "TelnetSocketPlugin",
                        error,
                )
                call.reject("Connection failed: ${error.message}", error)
              }
            }
    )
  }

  @PluginMethod
  fun disconnect(call: PluginCall) {
    runTask(
            Runnable {
              try {
                closeSocket()
                AppLogger.info(
                        context,
                        logTag,
                        "Telnet disconnected",
                        "TelnetSocketPlugin",
                )
                call.resolve(JSObject())
              } catch (error: Exception) {
                AppLogger.warn(
                        context,
                        logTag,
                        "Telnet disconnect error: ${error.message}",
                        "TelnetSocketPlugin",
                        error,
                )
                call.resolve(JSObject())
              }
            }
    )
  }

  @PluginMethod
  fun send(call: PluginCall) {
    val dataBase64 = call.getString("data")
    if (dataBase64.isNullOrBlank()) {
      call.reject("data is required")
      return
    }

    runTask(
            Runnable {
              try {
                val stream = outputStream
                if (stream == null) {
                  call.reject("Not connected")
                  return@Runnable
                }
                val bytes = Base64.decode(dataBase64, Base64.DEFAULT)
                stream.write(bytes)
                stream.flush()
                call.resolve(JSObject())
              } catch (error: Exception) {
                AppLogger.error(
                        context,
                        logTag,
                        "Telnet send failed: ${error.message}",
                        "TelnetSocketPlugin",
                        error,
                )
                call.reject("Send failed: ${error.message}", error)
              }
            }
    )
  }

  @PluginMethod
  fun read(call: PluginCall) {
    val timeoutMs = call.getInt("timeoutMs") ?: defaultReadTimeoutMs

    runTask(
            Runnable {
              try {
                val stream = inputStream
                val sock = socket
                if (stream == null || sock == null) {
                  call.reject("Not connected")
                  return@Runnable
                }
                val payload = readPayloadWithinBudget(stream, sock, timeoutMs)
                val data =
                        if (payload.isNotEmpty()) {
                          Base64.encodeToString(payload, Base64.NO_WRAP)
                        } else {
                          ""
                        }

                val result = JSObject()
                result.put("data", data)
                call.resolve(result)
              } catch (error: Exception) {
                AppLogger.error(
                        context,
                        logTag,
                        "Telnet read failed: ${error.message}",
                        "TelnetSocketPlugin",
                        error,
                )
                call.reject("Read failed: ${error.message}", error)
              }
            }
    )
  }

  @PluginMethod
  fun isConnected(call: PluginCall) {
    val connected = socket?.isConnected == true && socket?.isClosed != true
    val result = JSObject()
    result.put("connected", connected)
    call.resolve(result)
  }

  private fun readPayloadWithinBudget(stream: InputStream, sock: Socket, timeoutMs: Int): ByteArray {
    val boundedTimeoutMs = timeoutMs.coerceAtLeast(1)
    val startedAtNs = System.nanoTime()
    val buffer = ByteArray(4096)
    val output = ByteArrayOutputStream()

    try {
      sock.soTimeout = boundedTimeoutMs
      val firstRead =
              try {
                stream.read(buffer)
              } catch (_: SocketTimeoutException) {
                0
              }
      if (firstRead == -1) {
        // HARD20-006: EOF is a dead peer, not a harmless empty timeout read.
        closeSocket()
        throw IllegalStateException("Connection closed")
      }
      if (firstRead == 0) {
        return ByteArray(0)
      }
      output.write(buffer, 0, firstRead)

      while (true) {
        val elapsedMs = ((System.nanoTime() - startedAtNs) / 1_000_000L).toInt()
        val remainingMs = boundedTimeoutMs - elapsedMs
        if (remainingMs <= 0) {
          break
        }

        sock.soTimeout = minOf(readDrainSliceTimeoutMs, remainingMs)
        val nextRead =
                try {
                  stream.read(buffer)
                } catch (_: SocketTimeoutException) {
                  break
                }
        if (nextRead == -1) {
          closeSocket()
          throw IllegalStateException("Connection closed")
        }
        if (nextRead == 0) {
          break
        }
        output.write(buffer, 0, nextRead)
      }

      return output.toByteArray()
    } finally {
      if (!sock.isClosed) sock.soTimeout = boundedTimeoutMs
    }
  }

  private fun closeSocket() {
    try {
      inputStream?.close()
    } catch (error: Exception) {
      AppLogger.warn(
              context,
              logTag,
              "Failed to close Telnet input stream: ${error.message}",
              "TelnetSocketPlugin",
              error,
      )
    }
    try {
      outputStream?.close()
    } catch (error: Exception) {
      AppLogger.warn(
              context,
              logTag,
              "Failed to close Telnet output stream: ${error.message}",
              "TelnetSocketPlugin",
              error,
      )
    }
    try {
      socket?.close()
    } catch (error: Exception) {
      AppLogger.warn(
              context,
              logTag,
              "Failed to close Telnet socket: ${error.message}",
              "TelnetSocketPlugin",
              error,
      )
    }
    inputStream = null
    outputStream = null
    socket = null
  }

  override fun handleOnDestroy() {
    // Release the worker thread + any open socket when the bridge/activity is torn down,
    // so a WebView/activity recreation does not leak the non-daemon executor thread (and
    // the socket/streams it may still hold). closeSocket() below runs on THIS (destroy)
    // thread, not the executor - awaiting termination first (bounded by the same read
    // timeout budget every queued task is already limited by) ensures any still-running
    // connect()/send()/read() task has genuinely finished touching socket/inputStream/
    // outputStream before this thread closes and nulls them, instead of racing it.
    executor.shutdownNow()
    try {
      executor.awaitTermination(defaultReadTimeoutMs.toLong() * 2, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
    closeSocket()
    super.handleOnDestroy()
  }
}
