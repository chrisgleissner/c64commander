package uk.gleissner.c64commander.hvsc

object SonglengthsParser {
  data class Result(
    val pathToSeconds: Map<String, Int>,
    val md5ToSeconds: Map<String, Int>,
  )

  fun parse(content: String): Result {
    val pathToSeconds = mutableMapOf<String, Int>()
    val md5ToSeconds = mutableMapOf<String, Int>()
    var currentPath = ""

    val lines = content.split(Regex("\\r?\\n"))
    for (raw in lines) {
      val line = raw.trim()
      if (line.isBlank()) continue
      if (line.startsWith(";")) {
        val path = line.removePrefix(";").trim()
        if (path.isNotBlank()) currentPath = normalizePath(path)
        continue
      }
      if (line.startsWith("[")) continue
      val parts = line.split("=")
      if (parts.size != 2) continue
      val md5 = parts[0].trim()
      val time = parts[1].trim()
      if (md5.isBlank() || time.isBlank()) continue
      val totalSeconds = parseTimeToSeconds(time) ?: continue
      if (currentPath.isNotBlank()) {
        pathToSeconds[currentPath] = totalSeconds
      }
      md5ToSeconds[md5] = totalSeconds
    }

    return Result(pathToSeconds, md5ToSeconds)
  }

  fun parseText(content: String): Result {
    val pathToSeconds = mutableMapOf<String, Int>()
    val lines = content.split(Regex("\\r?\\n"))
    val timePattern = Regex("^(.+?)\\s+(\\d+:\\d{2}(?:\\.\\d{1,3})?)$")
    for (raw in lines) {
      val line = raw.trim()
      if (line.isBlank()) continue
      if (line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) continue
      val match = timePattern.find(line) ?: continue
      val path = match.groupValues[1].trim()
      val time = match.groupValues[2].trim()
      if (path.isBlank() || time.isBlank()) continue
      val seconds = parseTimeToSeconds(time) ?: continue
      pathToSeconds[normalizePath(path)] = seconds
    }
    return Result(pathToSeconds, emptyMap())
  }

  private fun normalizePath(path: String): String {
    val normalized = path.replace("\\", "/")
    return if (normalized.startsWith("/")) normalized else "/$normalized"
  }

  private fun parseTimeToSeconds(value: String): Int? {
    val timeParts = value.split(":")
    if (timeParts.isEmpty()) return null
    val minutes = timeParts[0].toIntOrNull() ?: return null
    val secondsPart = timeParts.getOrNull(1) ?: "0"
    val secondsSplit = secondsPart.split(".")
    val seconds = secondsSplit[0].toIntOrNull() ?: 0
    val fraction = secondsSplit.getOrNull(1)?.padEnd(3, '0')?.take(3)?.toIntOrNull() ?: 0
    val totalMs = (minutes * 60 + seconds) * 1000 + fraction
    return kotlin.math.round(totalMs / 1000.0).toInt()
  }
}
