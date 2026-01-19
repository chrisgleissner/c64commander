package com.c64.commander

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MockC64U")
class MockC64UPlugin : Plugin() {
  private var server: MockC64UServer? = null

  @PluginMethod
  fun startServer(call: PluginCall) {
    val config = call.getObject("config")
    if (config == null) {
      call.reject("config is required")
      return
    }

    try {
      if (server?.isRunning() == true) {
        val payload = JSObject()
        payload.put("port", server?.port ?: 0)
        payload.put("baseUrl", server?.baseUrl ?: "")
        call.resolve(payload)
        return
      }

      val preferredPort = call.getInt("preferredPort")
      val state = MockC64UState.fromPayload(config)
      val nextServer = MockC64UServer(state)
      val port = nextServer.start(preferredPort)
      server = nextServer
      val payload = JSObject()
      payload.put("port", port)
      payload.put("baseUrl", nextServer.baseUrl)
      call.resolve(payload)
    } catch (error: Exception) {
      call.reject(error.message, error)
    }
  }

  @PluginMethod
  fun stopServer(call: PluginCall) {
    try {
      server?.stop()
      server = null
      call.resolve()
    } catch (error: Exception) {
      call.reject(error.message, error)
    }
  }
}
