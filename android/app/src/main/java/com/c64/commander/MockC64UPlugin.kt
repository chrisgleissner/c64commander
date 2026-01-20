package uk.gleissner.c64commander

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MockC64U")
class MockC64UPlugin : Plugin() {
  private var server: MockC64UServer? = null
  private var ftpServer: MockFtpServer? = null

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
        payload.put("ftpPort", ftpServer?.port ?: 0)
        call.resolve(payload)
        return
      }

      val preferredPort = call.getInt("preferredPort")
      val state = MockC64UState.fromPayload(config)
      val nextServer = MockC64UServer(state)
      val port = nextServer.start(preferredPort)
      server = nextServer

      val ftpRoot = prepareFtpRootDir()
      val networkPassword = state.getNetworkPassword()
      val nextFtpServer = MockFtpServer(ftpRoot, networkPassword)
      val ftpPort = nextFtpServer.start()
      ftpServer = nextFtpServer
      val payload = JSObject()
      payload.put("port", port)
      payload.put("baseUrl", nextServer.baseUrl)
      payload.put("ftpPort", ftpPort)
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
      ftpServer?.stop()
      ftpServer = null
      call.resolve()
    } catch (error: Exception) {
      call.reject(error.message, error)
    }
  }

  private fun prepareFtpRootDir(): java.io.File {
    val root = java.io.File(context.cacheDir, "mock-ftp-root")
    if (root.exists()) {
      root.deleteRecursively()
    }
    root.mkdirs()
    copyAssets("ftp-root", root)
    return root
  }

  private fun copyAssets(assetPath: String, targetDir: java.io.File) {
    val assetManager = context.assets
    val entries = assetManager.list(assetPath) ?: return
    if (entries.isEmpty()) {
      val outputFile = java.io.File(targetDir, assetPath.substringAfterLast('/'))
      assetManager.open(assetPath).use { input ->
        outputFile.outputStream().use { output ->
          input.copyTo(output)
        }
      }
      return
    }

    entries.forEach { name ->
      val childAssetPath = if (assetPath.isBlank()) name else "$assetPath/$name"
      val childDir = java.io.File(targetDir, name)
      if ((assetManager.list(childAssetPath) ?: emptyArray()).isNotEmpty()) {
        childDir.mkdirs()
        copyAssets(childAssetPath, childDir)
      } else {
        assetManager.open(childAssetPath).use { input ->
          childDir.outputStream().use { output ->
            input.copyTo(output)
          }
        }
      }
    }
  }
}
