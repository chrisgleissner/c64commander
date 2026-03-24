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
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors

@CapacitorPlugin(name = "TelnetSocket")
class TelnetSocketPlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private val logTag = "TelnetSocketPlugin"
    private val defaultTimeoutMs = 5_000
    private val defaultReadTimeoutMs = 500

    internal var socketFactory: () -> Socket = { Socket() }
    internal var runTask: (Runnable) -> Unit = { runnable -> executor.execute(runnable) }

    private var socket: Socket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null

    @PluginMethod
    fun connect(call: PluginCall) {
        val host = call.getString("host")
        if (host.isNullOrBlank()) {
            call.reject("host is required")
            return
        }
        val port = call.getInt("port") ?: 23
        val timeoutMs = call.getInt("timeoutMs") ?: defaultTimeoutMs

        runTask(Runnable {
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
                call.resolve()
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
        })
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        runTask(Runnable {
            try {
                closeSocket()
                AppLogger.info(
                    context,
                    logTag,
                    "Telnet disconnected",
                    "TelnetSocketPlugin",
                )
                call.resolve()
            } catch (error: Exception) {
                AppLogger.warn(
                    context,
                    logTag,
                    "Telnet disconnect error: ${error.message}",
                    "TelnetSocketPlugin",
                    error,
                )
                call.resolve()
            }
        })
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val dataBase64 = call.getString("data")
        if (dataBase64.isNullOrBlank()) {
            call.reject("data is required")
            return
        }

        runTask(Runnable {
            try {
                val stream = outputStream
                if (stream == null) {
                    call.reject("Not connected")
                    return@Runnable
                }
                val bytes = Base64.decode(dataBase64, Base64.DEFAULT)
                stream.write(bytes)
                stream.flush()
                call.resolve()
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
        })
    }

    @PluginMethod
    fun read(call: PluginCall) {
        val timeoutMs = call.getInt("timeoutMs") ?: defaultReadTimeoutMs

        runTask(Runnable {
            try {
                val stream = inputStream
                val sock = socket
                if (stream == null || sock == null) {
                    call.reject("Not connected")
                    return@Runnable
                }
                sock.soTimeout = timeoutMs

                val buffer = ByteArray(4096)
                val bytesRead = try {
                    stream.read(buffer)
                } catch (_: SocketTimeoutException) {
                    0
                }

                val data = if (bytesRead > 0) {
                    Base64.encodeToString(buffer.copyOf(bytesRead), Base64.NO_WRAP)
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
        })
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        val connected = socket?.isConnected == true && socket?.isClosed != true
        val result = JSObject()
        result.put("connected", connected)
        call.resolve(result)
    }

    private fun closeSocket() {
        try {
            inputStream?.close()
        } catch (_: Exception) {}
        try {
            outputStream?.close()
        } catch (_: Exception) {}
        try {
            socket?.close()
        } catch (_: Exception) {}
        inputStream = null
        outputStream = null
        socket = null
    }
}
