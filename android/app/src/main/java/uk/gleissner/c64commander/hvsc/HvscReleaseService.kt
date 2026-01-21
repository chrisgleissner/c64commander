package uk.gleissner.c64commander.hvsc

import java.net.HttpURLConnection
import java.net.URL

interface HvscReleaseProvider {
  fun fetchLatestVersions(): Pair<Int, Int>
  fun buildBaselineUrl(version: Int): String
  fun buildUpdateUrl(version: Int): String
}

class HvscReleaseService(
  private val baseUrl: String = "https://hvsc.brona.dk/HVSC/",
) : HvscReleaseProvider {
  override fun fetchLatestVersions(): Pair<Int, Int> {
    val connection = URL(baseUrl).openConnection() as HttpURLConnection
    connection.connectTimeout = 15000
    connection.readTimeout = 20000
    connection.requestMethod = "GET"
    val response = connection.inputStream.bufferedReader().use { it.readText() }
    val baselineRegex = Regex("HVSC_(\\d+)-all-of-them\\.7z")
    val updateRegex = Regex("HVSC_Update_(\\d+)\\.7z")

    val baselineVersions = baselineRegex.findAll(response).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()
    val updateVersions = updateRegex.findAll(response).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()

    val baselineLatest = baselineVersions.maxOrNull() ?: 0
    val updateLatest = updateVersions.maxOrNull() ?: baselineLatest
    return baselineLatest to updateLatest
  }

  override fun buildBaselineUrl(version: Int): String = "${baseUrl}HVSC_${version}-all-of-them.7z"

  override fun buildUpdateUrl(version: Int): String = "${baseUrl}HVSC_Update_${version}.7z"
}
