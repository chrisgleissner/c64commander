/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

data class MockConfigDetails(
  val min: Number?,
  val max: Number?,
  val format: String?,
  val presets: List<String>?,
)

data class MockConfigItem(
  var value: Any,
  val options: List<String>?,
  val details: MockConfigDetails?,
)

data class MockGeneralInfo(
  val restApiVersion: String,
  val deviceType: String,
  val firmwareVersion: String,
  val baseUrl: String,
  val hostname: String,
  val uniqueId: String,
  val fpgaVersion: String,
  val coreVersion: String,
)

data class DrivePartition(
  val id: Int,
  val path: String,
)

data class DriveState(
  var enabled: Boolean,
  var busId: Int,
  var type: String,
  var rom: String?,
  var imageFile: String?,
  var imagePath: String?,
  var lastError: String?,
  var partitions: List<DrivePartition>?,
)

class MockC64UState private constructor(
  val general: MockGeneralInfo,
  private val defaults: Map<String, Map<String, MockConfigItem>>,
) {
  var config: MutableMap<String, MutableMap<String, MockConfigItem>> = cloneConfig(defaults)
    private set
  val drives: MutableMap<String, DriveState> = buildDriveState()
  var debugRegister: String = "00"
  val memory: MutableMap<Int, Int> = mutableMapOf()

  /** Monotonic clock in nanoseconds; replaceable so tests can step time. */
  var nanoClock: () -> Long = System::nanoTime
  private var runningSinceNanos: Long? = null
  private var runNanosBeforePause: Long = 0
  private var keyboardBufferFilledAtRunNanos: Long? = null

  // HARD12-017: REST-injected keyboard/joystick relay state (GET/POST
  // /v1/machine:input). `tap` transitions are momentary and never persist here.
  val machineInputKeyboard: MutableSet<String> = mutableSetOf()
  val machineInputJoysticks: MutableMap<Int, MutableSet<String>> = mutableMapOf(1 to mutableSetOf(), 2 to mutableSetOf())

  fun releaseAllMachineInput() {
    machineInputKeyboard.clear()
    machineInputJoysticks.values.forEach { it.clear() }
  }

  init {
    initializeVideoDefaults()
    resetKeyboardBuffer()
    runningSinceNanos = nanoClock()
  }

  /**
   * One byte as a running C64 would return it.
   *
   * The jiffy clock advances only while the CPU runs; the raster line always moves, because a pause halts the CPU
   * and not the VIC. The app's liveness check reads exactly these two to decide whether the machine is wedged, so
   * a simulator that kept them static made Save RAM refuse to run.
   */
  fun readMemoryByte(address: Int): Int {
    return when (address) {
      in JIFFY_CLOCK_START..JIFFY_CLOCK_END -> {
        val jiffies = runNanos() / JIFFY_NANOS
        ((jiffies shr (8 * (JIFFY_CLOCK_END - address))) and 0xFF).toInt()
      }
      RASTER_REGISTER -> ((nanoClock() / RASTER_LINE_NANOS) % PAL_RASTER_LINES and 0xFF).toInt()
      KEYBOARD_BUFFER_COUNT -> keyboardBufferCount()
      else -> memory[address] ?: 0
    }
  }

  fun writeMemoryByte(address: Int, value: Int) {
    memory[address] = value
    if (address == KEYBOARD_BUFFER_COUNT) {
      keyboardBufferFilledAtRunNanos = if (value > 0) runNanos() else null
    }
  }

  /**
   * A running KERNAL empties the keyboard buffer within a couple of jiffies. The simulator runs no
   * 6502 code, so it drains the buffer itself; otherwise every disk autostart in Demo Mode waited for
   * a buffer that never emptied and failed. A paused machine keeps its keys, as a real one does.
   */
  private fun keyboardBufferCount(): Int {
    val filledAt = keyboardBufferFilledAtRunNanos ?: return memory[KEYBOARD_BUFFER_COUNT] ?: 0
    if (runNanos() - filledAt < KEYBOARD_DRAIN_NANOS) return memory[KEYBOARD_BUFFER_COUNT] ?: 0
    memory[KEYBOARD_BUFFER_COUNT] = 0
    keyboardBufferFilledAtRunNanos = null
    return 0
  }

  fun pauseMachine() {
    val since = runningSinceNanos ?: return
    runNanosBeforePause += nanoClock() - since
    runningSinceNanos = null
  }

  /**
   * Resume, and let the next interrupt enter a capture hook if the app installed one.
   *
   * The app captures CPU state by pointing the KERNAL IRQ vector at a handler that stores the interrupted
   * registers and sets a flag. The simulator runs no 6502 code, so it performs that handler's visible effect
   * itself: the registers of a machine waiting at the BASIC prompt, and the captured flag.
   */
  fun resumeMachine() {
    if (runningSinceNanos == null) runningSinceNanos = nanoClock()
    enterArmedCaptureHandler()
  }

  /**
   * The app's CPU restore cartridge signals READY in `$02` from its cold start and spins until the app writes GO.
   * The simulator runs no 6502 code, so it raises READY itself; the app then writes the snapshot and releases it.
   */
  fun enterCpuRestoreCartridge() {
    memory[CPU_RESTORE_FLAG] = CPU_RESTORE_READY
  }

  fun restartMachine() {
    runningSinceNanos = nanoClock()
    runNanosBeforePause = 0
  }

  private fun runNanos(): Long {
    val since = runningSinceNanos ?: return runNanosBeforePause
    return runNanosBeforePause + (nanoClock() - since)
  }

  private fun enterArmedCaptureHandler() {
    val handler = (memory[KERNAL_IRQ_VECTOR] ?: 0) or ((memory[KERNAL_IRQ_VECTOR + 1] ?: 0) shl 8)
    // The capture handler opens with `LDA armed`; its register scratch sits in the seven bytes before `armed`
    // and the captured flag in the byte after it.
    if (memory[handler] != OPCODE_LDA_ABSOLUTE) return
    val armed = (memory[handler + 1] ?: 0) or ((memory[handler + 2] ?: 0) shl 8)
    if (memory[armed] != 1) return
    val scratch = armed - 7
    val frame = listOf(
      BASIC_IDLE_PC and 0xFF,
      BASIC_IDLE_PC shr 8,
      0x00, // A
      0x00, // X
      0x0A, // Y
      BASIC_IDLE_SP,
      BASIC_IDLE_P,
    )
    frame.forEachIndexed { index, value -> memory[scratch + index] = value }
    memory[armed] = 0
    memory[armed + 1] = 1
  }

  private fun initializeVideoDefaults() {
    memory[0xDD00] = 0x3F
    memory[0xD018] = 0x15

    repeat(1000) { offset ->
      memory[0x0400 + offset] = 0x20
      memory[0xD800 + offset] = 0x0E
    }
  }

  fun resetKeyboardBuffer() {
    val bufferStart = 0x0277
    val bufferLength = 10
    memory[KEYBOARD_BUFFER_COUNT] = 0
    keyboardBufferFilledAtRunNanos = null
    repeat(bufferLength) { offset ->
      memory[bufferStart + offset] = 0
    }
  }

  companion object {
    const val SOFT_IEC_DRIVE_KEY = "softiec"
    const val PRINTER_DRIVE_KEY = "printer"
    private const val SOFT_IEC_CATEGORY = "SoftIEC Drive Settings"
    private const val PRINTER_CATEGORY = "Printer Settings"
    private const val JIFFY_CLOCK_START = 0x00A0
    private const val JIFFY_CLOCK_END = 0x00A2
    private const val RASTER_REGISTER = 0xD012
    private const val KEYBOARD_BUFFER_COUNT = 0x00C6
    private const val KEYBOARD_DRAIN_NANOS = 2 * (1_000_000_000L / 60)
    private const val JIFFY_NANOS = 1_000_000_000L / 60
    private const val RASTER_LINE_NANOS = 64_000L
    private const val PAL_RASTER_LINES = 312L
    private const val KERNAL_IRQ_VECTOR = 0x0314
    private const val OPCODE_LDA_ABSOLUTE = 0xAD
    private const val CPU_RESTORE_FLAG = 0x02
    private const val CPU_RESTORE_READY = 0xA5
    /** Inside the KERNAL's keyboard wait loop, where a C64 at the READY prompt spends its time. */
    private const val BASIC_IDLE_PC = 0xE5CD
    private const val BASIC_IDLE_SP = 0xF6
    private const val BASIC_IDLE_P = 0x22

    fun fromPayload(payload: JSONObject): MockC64UState {
      val generalObj = payload.optJSONObject("general") ?: JSONObject()
      val baseUrl = generalObj.opt("baseUrl")?.toString()?.takeIf { it.isNotBlank() } ?: "http://c64u"
      val hostname = try {
        URI(baseUrl).host ?: "c64u"
      } catch (error: Exception) {
        Log.w("MockC64UState", "Failed to parse mock base URL: $baseUrl", error)
        "c64u"
      }
      val general = MockGeneralInfo(
        restApiVersion = generalObj.opt("restApiVersion")?.toString()?.takeIf { it.isNotBlank() } ?: "0.1",
        deviceType = generalObj.opt("deviceType")?.toString()?.takeIf { it.isNotBlank() } ?: "Ultimate 64",
        firmwareVersion = generalObj.opt("firmwareVersion")?.toString()?.takeIf { it.isNotBlank() } ?: "3.12a",
        baseUrl = baseUrl,
        hostname = hostname,
        uniqueId = "MOCK-${hostname.uppercase(Locale.ROOT)}",
        fpgaVersion = generalObj.opt("fpgaVersion")?.toString()?.takeIf { it.isNotBlank() } ?: "mock",
        coreVersion = generalObj.opt("coreVersion")?.toString()?.takeIf { it.isNotBlank() } ?: "mock",
      )

      val categoriesObj = payload.optJSONObject("categories") ?: JSONObject()
      val categories = mutableMapOf<String, Map<String, MockConfigItem>>()
      val categoryKeys = categoriesObj.keys()
      while (categoryKeys.hasNext()) {
        val categoryName = categoryKeys.next()
        val itemsObj = categoriesObj.optJSONObject(categoryName) ?: JSONObject()
        val itemKeys = itemsObj.keys()
        val items = mutableMapOf<String, MockConfigItem>()
        while (itemKeys.hasNext()) {
          val itemName = itemKeys.next()
          val itemObj = itemsObj.optJSONObject(itemName) ?: continue
          val value = unwrapJson(itemObj.opt("value")) ?: ""
          val options = itemObj.optJSONArray("options")?.let { jsonArrayToStringList(it) }
          val details = itemObj.optJSONObject("details")?.let { parseDetails(it) }
          items[itemName] = MockConfigItem(value, options, details)
        }
        categories[categoryName] = items
      }

      return MockC64UState(general, categories)
    }

    private fun unwrapJson(value: Any?): Any? {
      return if (value == JSONObject.NULL) null else value
    }

    private fun jsonArrayToStringList(array: JSONArray): List<String> {
      val results = mutableListOf<String>()
      for (index in 0 until array.length()) {
        val value = unwrapJson(array.opt(index))
        if (value != null) results.add(value.toString())
      }
      return results
    }

    private fun parseDetails(detailsObj: JSONObject): MockConfigDetails {
      val format = unwrapJson(detailsObj.opt("format"))?.toString()
      return MockConfigDetails(
        min = parseNumber(unwrapJson(detailsObj.opt("min"))),
        max = parseNumber(unwrapJson(detailsObj.opt("max"))),
        format = format,
        presets = detailsObj.optJSONArray("presets")?.let { jsonArrayToStringList(it) },
      )
    }

    private fun parseNumber(value: Any?): Number? {
      return when (value) {
        is Number -> value
        is String -> value.toDoubleOrNull()
        else -> null
      }
    }
  }

  fun listCategories(): List<String> = config.keys.sorted()

  fun getCategory(category: String): Map<String, MockConfigItem>? = config[category]

  fun updateConfigValue(category: String, item: String, value: Any) {
    val items = config.getOrPut(category) { mutableMapOf() }
    val existing = items[item]
    if (existing != null) {
      existing.value = value
    } else {
      items[item] = MockConfigItem(value, null, null)
    }
    refreshDriveState(category)
  }

  fun updateConfigBatch(payload: JSONObject) {
    val categoryKeys = payload.keys()
    while (categoryKeys.hasNext()) {
      val categoryName = categoryKeys.next()
      val itemsObj = payload.optJSONObject(categoryName) ?: continue
      val itemKeys = itemsObj.keys()
      while (itemKeys.hasNext()) {
        val itemName = itemKeys.next()
        val value = unwrapJson(itemsObj.opt(itemName)) ?: ""
        updateConfigValue(categoryName, itemName, value)
      }
    }
  }

  fun resetConfig() {
    config = cloneConfig(defaults)
    refreshDriveState()
  }

  fun getNetworkPassword(): String? {
    val value = config["Network Settings"]?.get("Network Password")?.value?.toString() ?: ""
    return value
  }

  private fun refreshDriveState(category: String? = null) {
    when (category) {
      "Drive A Settings" -> drives["a"] = buildDriveStateFor("a", config[category], drives["a"])
      "Drive B Settings" -> drives["b"] = buildDriveStateFor("b", config[category], drives["b"])
      SOFT_IEC_CATEGORY -> drives[SOFT_IEC_DRIVE_KEY] = buildSoftIecState(drives[SOFT_IEC_DRIVE_KEY])
      PRINTER_CATEGORY -> drives[PRINTER_DRIVE_KEY] = buildPrinterState()
      null -> {
        drives["a"] = buildDriveStateFor("a", config["Drive A Settings"], drives["a"])
        drives["b"] = buildDriveStateFor("b", config["Drive B Settings"], drives["b"])
        drives[SOFT_IEC_DRIVE_KEY] = buildSoftIecState(drives[SOFT_IEC_DRIVE_KEY])
        drives[PRINTER_DRIVE_KEY] = buildPrinterState()
      }
    }
  }

  /** Keyed by the endpoint name the app addresses (`/v1/drives/softiec:reset`), listed in the firmware's order. */
  private fun buildDriveState(): MutableMap<String, DriveState> {
    val driveMap = linkedMapOf<String, DriveState>()
    driveMap["a"] = buildDriveStateFor("a", config["Drive A Settings"], null)
    driveMap["b"] = buildDriveStateFor("b", config["Drive B Settings"], null)
    driveMap[SOFT_IEC_DRIVE_KEY] = buildSoftIecState(null)
    driveMap[PRINTER_DRIVE_KEY] = buildPrinterState()
    return driveMap
  }

  private fun buildSoftIecState(existing: DriveState?): DriveState {
    val items = config[SOFT_IEC_CATEGORY]
    return DriveState(
      enabled = items?.get("IEC Drive")?.value?.toString()?.equals("Enabled", true) == true,
      busId = parseInt(items?.get("Soft Drive Bus ID")?.value, 11),
      type = "DOS emulation",
      rom = null,
      imageFile = existing?.imageFile,
      imagePath = existing?.imagePath,
      lastError = existing?.lastError ?: "73,U64IEC ULTIMATE DOS V1.1,00,00",
      partitions = existing?.partitions ?: listOf(DrivePartition(0, "/Usb0/")),
    )
  }

  private fun buildPrinterState(): DriveState {
    val items = config[PRINTER_CATEGORY]
    return DriveState(
      enabled = items?.get("IEC printer")?.value?.toString()?.equals("Enabled", true) == true,
      busId = parseInt(items?.get("Bus ID")?.value, 4),
      type = "",
      rom = null,
      imageFile = null,
      imagePath = null,
      lastError = null,
      partitions = null,
    )
  }

  private fun buildDriveStateFor(
    driveKey: String,
    items: Map<String, MockConfigItem>?,
    existing: DriveState?,
  ): DriveState {
    val enabled = items?.get("Drive")?.value?.toString()?.equals("Enabled", true) == true
    val busId = parseInt(items?.get("Drive Bus ID")?.value, if (driveKey == "a") 8 else 9)
    val type = items?.get("Drive Type")?.value?.toString() ?: existing?.type ?: "1541"
    val rom = resolveRom(type, items) ?: existing?.rom
    return DriveState(
      enabled = enabled,
      busId = busId,
      type = type,
      rom = rom,
      imageFile = existing?.imageFile,
      imagePath = existing?.imagePath,
      lastError = existing?.lastError,
      partitions = existing?.partitions,
    )
  }

  private fun resolveRom(type: String, items: Map<String, MockConfigItem>?): String? {
    val key = when (type) {
      "1571" -> "ROM for 1571 mode"
      "1581" -> "ROM for 1581 mode"
      else -> "ROM for 1541 mode"
    }
    return items?.get(key)?.value?.toString()
  }

  private fun parseInt(value: Any?, fallback: Int): Int {
    return when (value) {
      is Number -> value.toInt()
      is String -> value.toIntOrNull() ?: fallback
      else -> fallback
    }
  }

  private fun cloneConfig(
    source: Map<String, Map<String, MockConfigItem>>,
  ): MutableMap<String, MutableMap<String, MockConfigItem>> {
    val copy = mutableMapOf<String, MutableMap<String, MockConfigItem>>()
    source.forEach { (category, items) ->
      val itemCopy = mutableMapOf<String, MockConfigItem>()
      items.forEach { (name, item) ->
        val details = item.details?.let {
          MockConfigDetails(it.min, it.max, it.format, it.presets?.toList())
        }
        itemCopy[name] = MockConfigItem(item.value, item.options?.toList(), details)
      }
      copy[category] = itemCopy
    }
    return copy
  }
}
