package uk.gleissner.c64commander.hvsc

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal data class HvscUpdateRecord(
  val version: Int,
  val status: String,
  val error: String?,
)

internal data class HvscState(
  val installedBaselineVersion: Int?,
  val installedVersion: Int,
  val ingestionState: String,
  val lastUpdateCheckUtcMs: Long?,
  val ingestionError: String?,
  val updates: Map<Int, HvscUpdateRecord>,
)

internal class HvscStateStore(private val stateFile: File) {
  private fun defaultState() = HvscState(
    installedBaselineVersion = null,
    installedVersion = 0,
    ingestionState = "idle",
    lastUpdateCheckUtcMs = null,
    ingestionError = null,
    updates = emptyMap(),
  )

  fun load(): HvscState {
    if (!stateFile.exists()) return defaultState()
    return runCatching {
      val raw = stateFile.readText()
      val json = JSONObject(raw)
      val updatesJson = json.optJSONArray("updates") ?: JSONArray()
      val updates = mutableMapOf<Int, HvscUpdateRecord>()
      for (index in 0 until updatesJson.length()) {
        val entry = updatesJson.optJSONObject(index) ?: continue
        val version = entry.optInt("version", 0)
        if (version <= 0) continue
        updates[version] = HvscUpdateRecord(
          version = version,
          status = entry.optString("status", "").ifBlank { "unknown" },
          error = if (entry.has("error") && !entry.isNull("error")) entry.optString("error") else null,
        )
      }
      HvscState(
        installedBaselineVersion = if (json.has("installedBaselineVersion")) json.optInt("installedBaselineVersion") else null,
        installedVersion = json.optInt("installedVersion", 0),
        ingestionState = json.optString("ingestionState", "idle"),
        lastUpdateCheckUtcMs = if (json.has("lastUpdateCheckUtcMs")) json.optLong("lastUpdateCheckUtcMs") else null,
        ingestionError = if (json.has("ingestionError") && !json.isNull("ingestionError")) json.optString("ingestionError") else null,
        updates = updates,
      )
    }.getOrElse { defaultState() }
  }

  fun save(state: HvscState) {
    stateFile.parentFile?.let { parent ->
      if (!parent.exists()) {
        parent.mkdirs()
      }
    }
    val json = JSONObject()
    state.installedBaselineVersion?.let { json.put("installedBaselineVersion", it) }
    json.put("installedVersion", state.installedVersion)
    json.put("ingestionState", state.ingestionState)
    state.lastUpdateCheckUtcMs?.let { json.put("lastUpdateCheckUtcMs", it) }
    state.ingestionError?.let { json.put("ingestionError", it) }
    val updates = JSONArray()
    state.updates.values.sortedBy { it.version }.forEach { record ->
      val entry = JSONObject()
      entry.put("version", record.version)
      entry.put("status", record.status)
      record.error?.let { entry.put("error", it) }
      updates.put(entry)
    }
    json.put("updates", updates)
    stateFile.writeText(json.toString())
  }

  fun updateMeta(
    installedBaselineVersion: Int? = null,
    installedVersion: Int? = null,
    ingestionState: String? = null,
    lastUpdateCheckUtcMs: Long? = null,
    ingestionError: String? = null,
    clearIngestionError: Boolean = false,
  ): HvscState {
    val current = load()
    val next = current.copy(
      installedBaselineVersion = installedBaselineVersion ?: current.installedBaselineVersion,
      installedVersion = installedVersion ?: current.installedVersion,
      ingestionState = ingestionState ?: current.ingestionState,
      lastUpdateCheckUtcMs = lastUpdateCheckUtcMs ?: current.lastUpdateCheckUtcMs,
      ingestionError = when {
        clearIngestionError -> null
        ingestionError != null -> ingestionError
        else -> current.ingestionError
      },
    )
    save(next)
    return next
  }

  fun markUpdateApplied(version: Int, status: String, error: String?): HvscState {
    val current = load()
    val next = current.copy(
      updates = current.updates + (version to HvscUpdateRecord(version, status, error)),
    )
    save(next)
    return next
  }

  fun isUpdateApplied(version: Int): Boolean {
    val record = load().updates[version] ?: return false
    return record.status == "success"
  }
}

internal fun HvscState.toMeta(): HvscMeta {
  return HvscMeta(
    installedBaselineVersion = installedBaselineVersion,
    installedVersion = installedVersion,
    ingestionState = ingestionState,
    lastUpdateCheckUtcMs = lastUpdateCheckUtcMs,
    ingestionError = ingestionError,
  )
}
