package uk.gleissner.c64commander

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

data class HttpRequest(
  val method: String,
  val path: String,
  val queryParams: Map<String, String>,
  val headers: Map<String, String>,
  val body: ByteArray,
)

data class HttpResponse(
  val status: Int,
  val headers: Map<String, String>,
  val body: ByteArray,
)

class MockC64UServer(private val state: MockC64UState) {
  private val executor = Executors.newCachedThreadPool()
  private val sockets = Collections.synchronizedSet(mutableSetOf<Socket>())
  private var serverSocket: ServerSocket? = null
  @Volatile private var running = false
  var port: Int = 0
    private set

  val baseUrl: String
    get() = "http://127.0.0.1:$port"

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
    serverSocket?.close()
    sockets.forEach { socket ->
      try {
        socket.close()
      } catch (_: Exception) {
        // Ignore cleanup errors
      }
    }
    sockets.clear()
    executor.shutdownNow()
  }

  fun isRunning(): Boolean = running

  private fun acceptLoop() {
    while (running) {
      try {
        val socket = serverSocket?.accept() ?: break
        sockets.add(socket)
        executor.execute { handleClient(socket) }
      } catch (_: Exception) {
        if (running) {
          // Ignore intermittent accept errors while running.
        }
      }
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use { client ->
      val input = BufferedInputStream(client.getInputStream())
      val output = BufferedOutputStream(client.getOutputStream())
      val request = readRequest(input) ?: return
      val response = handleRequest(request)
      writeResponse(output, response)
      output.flush()
    }
    sockets.remove(socket)
  }

  private fun readRequest(input: InputStream): HttpRequest? {
    val requestLine = readLine(input) ?: return null
    if (requestLine.isBlank()) return null
    val parts = requestLine.split(" ")
    if (parts.size < 2) return null
    val method = parts[0].trim().uppercase(Locale.ROOT)
    val target = parts[1].trim()
    val path = target.substringBefore("?")
    val query = target.substringAfter("?", "")
    val headers = mutableMapOf<String, String>()

    while (true) {
      val line = readLine(input) ?: break
      if (line.isEmpty()) break
      val idx = line.indexOf(":")
      if (idx <= 0) continue
      val name = line.substring(0, idx).trim().lowercase(Locale.ROOT)
      val value = line.substring(idx + 1).trim()
      headers[name] = value
    }

    val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
    val body = if (contentLength > 0) {
      readBytes(input, contentLength)
    } else {
      ByteArray(0)
    }

    return HttpRequest(method, path, parseQuery(query), headers, body)
  }

  private fun readLine(input: InputStream): String? {
    val buffer = ByteArrayOutputStream()
    while (true) {
      val byte = input.read()
      if (byte == -1) {
        return if (buffer.size() == 0) null else buffer.toString(StandardCharsets.UTF_8.name())
      }
      if (byte == '\n'.code) {
        break
      }
      if (byte != '\r'.code) {
        buffer.write(byte)
      }
    }
    return buffer.toString(StandardCharsets.UTF_8.name())
  }

  private fun readBytes(input: InputStream, length: Int): ByteArray {
    val buffer = ByteArray(length)
    var offset = 0
    while (offset < length) {
      val read = input.read(buffer, offset, length - offset)
      if (read == -1) break
      offset += read
    }
    return if (offset == length) buffer else buffer.copyOf(offset)
  }

  private fun parseQuery(query: String): Map<String, String> {
    if (query.isBlank()) return emptyMap()
    return query.split("&").mapNotNull { part ->
      if (part.isBlank()) return@mapNotNull null
      val key = part.substringBefore("=").trim()
      val rawValue = part.substringAfter("=", "")
      if (key.isBlank()) return@mapNotNull null
      decode(key) to decode(rawValue)
    }.toMap()
  }

  private fun decode(value: String): String =
    URLDecoder.decode(value, StandardCharsets.UTF_8.toString())

  private fun handleRequest(request: HttpRequest): HttpResponse {
    if (request.method == "OPTIONS") {
      return HttpResponse(204, emptyMap(), ByteArray(0))
    }

    val path = request.path
    if (request.method == "GET" && path == "/v1/version") {
      val payload = JSONObject()
      payload.put("version", state.general.restApiVersion)
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    if (request.method == "GET" && path == "/v1/info") {
      val payload = JSONObject()
      payload.put("product", state.general.deviceType)
      payload.put("firmware_version", state.general.firmwareVersion)
      payload.put("fpga_version", state.general.fpgaVersion)
      payload.put("core_version", state.general.coreVersion)
      payload.put("hostname", state.general.hostname)
      payload.put("unique_id", state.general.uniqueId)
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    if (path == "/v1/runners:sidplay" && (request.method == "PUT" || request.method == "POST")) {
      if (request.method == "PUT" && !request.queryParams.containsKey("file")) {
        return errorResponse(400, "Missing file")
      }
      return okResponse()
    }

    if (path == "/v1/runners:modplay" && (request.method == "PUT" || request.method == "POST")) {
      if (request.method == "PUT" && !request.queryParams.containsKey("file")) {
        return errorResponse(400, "Missing file")
      }
      return okResponse()
    }

    if (path == "/v1/runners:load_prg" && (request.method == "PUT" || request.method == "POST")) {
      if (request.method == "PUT" && !request.queryParams.containsKey("file")) {
        return errorResponse(400, "Missing file")
      }
      return okResponse()
    }

    if (path == "/v1/runners:run_prg" && (request.method == "PUT" || request.method == "POST")) {
      if (request.method == "PUT" && !request.queryParams.containsKey("file")) {
        return errorResponse(400, "Missing file")
      }
      return okResponse()
    }

    if (path == "/v1/runners:run_crt" && (request.method == "PUT" || request.method == "POST")) {
      if (request.method == "PUT" && !request.queryParams.containsKey("file")) {
        return errorResponse(400, "Missing file")
      }
      return okResponse()
    }

    if (path == "/v1/configs" && request.method == "GET") {
      val payload = JSONObject()
      payload.put("categories", JSONArray(state.listCategories()))
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    if (path == "/v1/configs" && request.method == "POST") {
      val body = String(request.body, StandardCharsets.UTF_8)
      if (body.isNotBlank()) {
        try {
          val payload = JSONObject(body)
          state.updateConfigBatch(payload)
        } catch (error: Exception) {
          return errorResponse(400, error.message ?: "Invalid JSON payload")
        }
      }
      return okResponse()
    }

    val configCategoryMatch = Regex("^/v1/configs/([^/]+)$").find(path)
    if (configCategoryMatch != null && request.method == "GET") {
      val rawCategory = decode(configCategoryMatch.groupValues[1])
      val matched = resolveCategories(rawCategory)
      if (matched.isEmpty()) {
        return errorResponse(404, "Category not found")
      }
      val payload = JSONObject()
      matched.forEach { categoryName ->
        val items = state.getCategory(categoryName) ?: emptyMap()
        payload.put(categoryName, buildCategoryPayload(items))
      }
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    val configItemMatch = Regex("^/v1/configs/([^/]+)/([^/]+)$").find(path)
    if (configItemMatch != null) {
      val category = decode(configItemMatch.groupValues[1])
      val item = decode(configItemMatch.groupValues[2])
      if (request.method == "PUT") {
        val value = request.queryParams["value"]
        if (value == null) {
          return errorResponse(400, "Missing value")
        }
        state.updateConfigValue(category, item, value)
        return okResponse()
      }
      if (request.method == "GET") {
        val items = state.getCategory(category) ?: return errorResponse(404, "Category not found")
        val entry = items[item] ?: return errorResponse(404, "Item not found")
        val payload = JSONObject()
        payload.put(category, buildCategoryPayload(mapOf(item to entry)))
        payload.put("errors", JSONArray())
        return jsonResponse(200, payload)
      }
    }

    if (
      request.method == "PUT" &&
      setOf(
        "/v1/configs:load_from_flash",
        "/v1/configs:save_to_flash",
      ).contains(path)
    ) {
      return okResponse()
    }

    if (request.method == "PUT" && path == "/v1/configs:reset_to_default") {
      state.resetConfig()
      return okResponse()
    }

    if (
      request.method == "PUT" &&
      setOf(
        "/v1/machine:reset",
        "/v1/machine:reboot",
        "/v1/machine:pause",
        "/v1/machine:resume",
        "/v1/machine:poweroff",
        "/v1/machine:menu_button",
      ).contains(path)
    ) {
      return okResponse()
    }

    if (path == "/v1/machine:writemem" && (request.method == "PUT" || request.method == "POST")) {
      val address = parseHex(request.queryParams["address"])
        ?: return errorResponse(400, "Missing address")
      val bytes = if (request.method == "PUT") {
        val data = request.queryParams["data"] ?: return errorResponse(400, "Missing data")
        parseHexBytes(data) ?: return errorResponse(400, "Invalid data")
      } else {
        request.body.map { it.toInt() and 0xFF }
      }
      bytes.forEachIndexed { idx, value ->
        state.memory[address + idx] = value
      }
      return okResponse()
    }

    if (path == "/v1/machine:readmem" && request.method == "GET") {
      val address = parseHex(request.queryParams["address"])
        ?: return errorResponse(400, "Missing address")
      val length = request.queryParams["length"]?.toIntOrNull()?.let { min(max(it, 1), 4096) } ?: 256
      val data = JSONArray()
      repeat(length) { offset ->
        val value = state.memory[address + offset] ?: 0
        data.put(value)
      }
      val payload = JSONObject()
      payload.put("data", data)
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    if (path == "/v1/machine:debugreg") {
      if (request.method == "GET") {
        val payload = JSONObject()
        payload.put("value", state.debugRegister)
        payload.put("errors", JSONArray())
        return jsonResponse(200, payload)
      }
      if (request.method == "PUT") {
        val value = request.queryParams["value"] ?: return errorResponse(400, "Missing value")
        state.debugRegister = value
        val payload = JSONObject()
        payload.put("value", state.debugRegister)
        payload.put("errors", JSONArray())
        return jsonResponse(200, payload)
      }
    }

    if (path == "/v1/drives" && request.method == "GET") {
      return jsonResponse(200, buildDrivesPayload())
    }

    val driveMatch = Regex("^/v1/drives/([^/]+):([a-z_]+)$").find(path)
    if (driveMatch != null && (request.method == "PUT" || request.method == "POST")) {
      val driveKey = decode(driveMatch.groupValues[1]).lowercase(Locale.ROOT)
      val action = driveMatch.groupValues[2]
      val drive = state.drives[driveKey] ?: return errorResponse(404, "Drive not found")

      when (action) {
        "mount" -> {
          val image = if (request.method == "PUT") {
            request.queryParams["image"] ?: return errorResponse(400, "Missing image")
          } else {
            request.queryParams["image"] ?: "upload-${System.currentTimeMillis()}"
          }
          val imageFile = image.substringAfterLast('/')
          val imagePath = image.substringBeforeLast('/', "")
          drive.imageFile = imageFile
          drive.imagePath = if (imagePath.isBlank()) null else imagePath
          return okResponse()
        }
        "reset" -> return okResponse()
        "remove" -> {
          drive.imageFile = null
          drive.imagePath = null
          return okResponse()
        }
        "on" -> {
          drive.enabled = true
          return okResponse()
        }
        "off" -> {
          drive.enabled = false
          return okResponse()
        }
        "load_rom" -> {
          val file = if (request.method == "PUT") {
            request.queryParams["file"] ?: return errorResponse(400, "Missing file")
          } else {
            request.queryParams["file"] ?: "upload-${System.currentTimeMillis()}.rom"
          }
          drive.rom = file.substringAfterLast('/')
          return okResponse()
        }
        "set_mode" -> {
          val mode = request.queryParams["mode"] ?: return errorResponse(400, "Missing mode")
          drive.type = mode
          drive.rom = resolveDriveRom(driveKey, mode) ?: drive.rom
          return okResponse()
        }
      }
    }

    val streamMatch = Regex("^/v1/streams/([^/]+):(start|stop)$").find(path)
    if (streamMatch != null && request.method == "PUT") {
      if (streamMatch.groupValues[2] == "start" && !request.queryParams.containsKey("ip")) {
        return errorResponse(400, "Missing ip")
      }
      return okResponse()
    }

    val fileInfoMatch = Regex("^/v1/files/(.+):info$").find(path)
    if (fileInfoMatch != null && request.method == "GET") {
      val filePath = decode(fileInfoMatch.groupValues[1])
      val payload = JSONObject()
      val fileObj = JSONObject()
      fileObj.put("path", if (filePath.startsWith("/")) filePath else "/$filePath")
      fileObj.put("filename", filePath.substringAfterLast('/'))
      fileObj.put("size", 0)
      val ext = filePath.substringAfterLast('.', "").uppercase(Locale.ROOT)
      fileObj.put("extension", ext)
      payload.put("files", fileObj)
      payload.put("errors", JSONArray())
      return jsonResponse(200, payload)
    }

    val fileCreateMatch = Regex("^/v1/files/(.+):create_(d64|d71|d81|dnp)$").find(path)
    if (fileCreateMatch != null && request.method == "PUT") {
      if (fileCreateMatch.groupValues[2] == "dnp" && !request.queryParams.containsKey("tracks")) {
        return errorResponse(400, "Missing tracks")
      }
      return okResponse()
    }

    return errorResponse(404, "Not found")
  }

  private fun resolveCategories(rawCategory: String): List<String> {
    if (rawCategory.contains("*")) {
      val escaped = Regex.escape(rawCategory).replace("\\*", ".*")
      val regex = Regex("^$escaped$")
      return state.listCategories().filter { regex.matches(it) }
    }
    return if (state.getCategory(rawCategory) != null) listOf(rawCategory) else emptyList()
  }

  private fun resolveDriveRom(driveKey: String, mode: String): String? {
    val category = if (driveKey == "a") "Drive A Settings" else "Drive B Settings"
    val items = state.getCategory(category) ?: return null
    val key = when (mode) {
      "1571" -> "ROM for 1571 mode"
      "1581" -> "ROM for 1581 mode"
      else -> "ROM for 1541 mode"
    }
    return items[key]?.value?.toString()
  }

  private fun parseHex(value: String?): Int? {
    if (value.isNullOrBlank()) return null
    val cleaned = value.trim().lowercase(Locale.ROOT)
      .removePrefix("0x")
      .removePrefix("$")
    return cleaned.toIntOrNull(16)
  }

  private fun parseHexBytes(value: String): List<Int>? {
    val cleaned = value.replace("\\s+".toRegex(), "")
    if (cleaned.length % 2 != 0) return null
    val bytes = mutableListOf<Int>()
    for (idx in cleaned.indices step 2) {
      val part = cleaned.substring(idx, idx + 2)
      val parsed = part.toIntOrNull(16) ?: return null
      bytes.add(parsed)
    }
    return bytes
  }

  private fun buildDrivesPayload(): JSONObject {
    val drivesArray = JSONArray()
    state.drives.forEach { (key, drive) ->
      val driveObj = JSONObject()
      val info = JSONObject()
      info.put("enabled", drive.enabled)
      info.put("bus_id", drive.busId)
      info.put("type", drive.type)
      drive.rom?.let { info.put("rom", it) }
      drive.imageFile?.let { info.put("image_file", it) }
      drive.imagePath?.let { info.put("image_path", it) }
      drive.lastError?.let { info.put("last_error", it) }
      drive.partitions?.let { partitions ->
        val array = JSONArray()
        partitions.forEach { partition ->
          val payload = JSONObject()
          payload.put("id", partition.id)
          payload.put("path", partition.path)
          array.put(payload)
        }
        info.put("partitions", array)
      }
      driveObj.put(key, info)
      drivesArray.put(driveObj)
    }
    val payload = JSONObject()
    payload.put("drives", drivesArray)
    payload.put("errors", JSONArray())
    return payload
  }

  private fun buildCategoryPayload(items: Map<String, MockConfigItem>): JSONObject {
    val itemsObj = JSONObject()
    items.forEach { (name, item) ->
      itemsObj.put(name, buildConfigItem(item))
    }
    val categoryObj = JSONObject()
    categoryObj.put("items", itemsObj)
    return categoryObj
  }

  private fun buildConfigItem(item: MockConfigItem): JSONObject {
    val payload = JSONObject()
    payload.put("selected", item.value)
    item.options?.let { payload.put("options", JSONArray(it)) }
    item.details?.let { details ->
      val detailsObj = JSONObject()
      details.min?.let { detailsObj.put("min", it) }
      details.max?.let { detailsObj.put("max", it) }
      details.format?.let { detailsObj.put("format", it) }
      details.presets?.let { detailsObj.put("presets", JSONArray(it)) }
      payload.put("details", detailsObj)
    }
    return payload
  }

  private fun okResponse(): HttpResponse {
    val payload = JSONObject()
    payload.put("errors", JSONArray())
    return jsonResponse(200, payload)
  }

  private fun errorResponse(status: Int, message: String): HttpResponse {
    val payload = JSONObject()
    payload.put("errors", JSONArray().put(message))
    return jsonResponse(status, payload)
  }

  private fun jsonResponse(status: Int, payload: JSONObject): HttpResponse {
    val body = payload.toString().toByteArray(StandardCharsets.UTF_8)
    val headers = mapOf("Content-Type" to "application/json")
    return HttpResponse(status, headers, body)
  }

  private fun writeResponse(output: OutputStream, response: HttpResponse) {
    val statusText = when (response.status) {
      200 -> "OK"
      204 -> "No Content"
      400 -> "Bad Request"
      404 -> "Not Found"
      else -> "Internal Server Error"
    }
    output.write("HTTP/1.1 ${response.status} $statusText\r\n".toByteArray(StandardCharsets.UTF_8))
    val headers = mutableMapOf(
      "Access-Control-Allow-Origin" to "*",
      "Access-Control-Allow-Methods" to "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers" to "Content-Type, X-Password, X-C64U-Host",
      "Connection" to "close",
    )
    headers.putAll(response.headers)
    headers["Content-Length"] = response.body.size.toString()
    headers.forEach { (name, value) ->
      output.write("$name: $value\r\n".toByteArray(StandardCharsets.UTF_8))
    }
    output.write("\r\n".toByteArray(StandardCharsets.UTF_8))
    output.write(response.body)
  }
}
