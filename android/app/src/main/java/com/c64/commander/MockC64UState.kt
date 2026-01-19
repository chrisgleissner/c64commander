package com.c64.commander

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

  companion object {
    fun fromPayload(payload: JSONObject): MockC64UState {
      val generalObj = payload.optJSONObject("general") ?: JSONObject()
      val baseUrl = generalObj.optString("baseUrl", "http://c64u")
      val hostname = try {
        URI(baseUrl).host ?: "c64u"
      } catch (_: Exception) {
        "c64u"
      }
      val general = MockGeneralInfo(
        restApiVersion = generalObj.optString("restApiVersion", "0.1"),
        deviceType = generalObj.optString("deviceType", "Ultimate 64"),
        firmwareVersion = generalObj.optString("firmwareVersion", "3.12a"),
        baseUrl = baseUrl,
        hostname = hostname,
        uniqueId = "MOCK-${hostname.uppercase(Locale.ROOT)}",
        fpgaVersion = generalObj.optString("fpgaVersion", "mock"),
        coreVersion = generalObj.optString("coreVersion", "mock"),
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

  private fun refreshDriveState(category: String? = null) {
    val targets = when (category) {
      "Drive A Settings" -> listOf("a")
      "Drive B Settings" -> listOf("b")
      else -> listOf("a", "b")
    }

    targets.forEach { driveKey ->
      val categoryName = if (driveKey == "a") "Drive A Settings" else "Drive B Settings"
      val items = config[categoryName]
      val existing = drives[driveKey]
      drives[driveKey] = buildDriveStateFor(driveKey, items, existing)
    }
  }

  private fun buildDriveState(): MutableMap<String, DriveState> {
    val driveMap = mutableMapOf<String, DriveState>()
    driveMap["a"] = buildDriveStateFor("a", config["Drive A Settings"], null)
    driveMap["b"] = buildDriveStateFor("b", config["Drive B Settings"], null)
    return driveMap
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
