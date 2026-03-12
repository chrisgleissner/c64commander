package uk.gleissner.c64commander

import kotlin.math.abs
import kotlin.math.max
import org.json.JSONObject

data class MockTimingClassConfig(
        val baseDelayMs: Int,
        val jitterRangeMs: Int,
        val jitterSeed: Int,
)

data class MockTimingFaults(
        val slowExtraDelayMs: Int,
        val slowJitterRangeMs: Int,
        val timeoutMinimumDelayMs: Int,
)

data class MockTimingRule(
        val methods: Set<String>,
        val pathType: String,
        val path: String,
        val timingClass: String,
)

class MockTimingProfile(
        private val seed: Int,
        private val defaultClassId: String,
        private val classes: Map<String, MockTimingClassConfig>,
        private val rules: List<MockTimingRule>,
        private val faults: MockTimingFaults,
) {
  companion object {
    fun defaultProfile(): MockTimingProfile {
      return MockTimingProfile(
              seed = 19,
              defaultClassId = "default",
              classes =
                      mapOf(
                              "probe" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 35,
                                              jitterRangeMs = 12,
                                              jitterSeed = 1
                                      ),
                              "configRead" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 55,
                                              jitterRangeMs = 18,
                                              jitterSeed = 2
                                      ),
                              "configWrite" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 95,
                                              jitterRangeMs = 24,
                                              jitterSeed = 3
                                      ),
                              "machineControl" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 85,
                                              jitterRangeMs = 22,
                                              jitterSeed = 4
                                      ),
                              "memoryRead" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 45,
                                              jitterRangeMs = 14,
                                              jitterSeed = 5
                                      ),
                              "memoryWrite" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 70,
                                              jitterRangeMs = 20,
                                              jitterSeed = 6
                                      ),
                              "driveAction" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 90,
                                              jitterRangeMs = 28,
                                              jitterSeed = 7
                                      ),
                              "runner" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 110,
                                              jitterRangeMs = 32,
                                              jitterSeed = 8
                                      ),
                              "streamControl" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 80,
                                              jitterRangeMs = 20,
                                              jitterSeed = 9
                                      ),
                              "default" to
                                      MockTimingClassConfig(
                                              baseDelayMs = 60,
                                              jitterRangeMs = 16,
                                              jitterSeed = 10
                                      ),
                      ),
              rules =
                      listOf(
                              MockTimingRule(
                                      methods = setOf("OPTIONS"),
                                      pathType = "prefix",
                                      path = "/",
                                      timingClass = "probe"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "exact",
                                      path = "/v1/info",
                                      timingClass = "probe"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "exact",
                                      path = "/v1/version",
                                      timingClass = "probe"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "exact",
                                      path = "/v1/configs",
                                      timingClass = "configRead"
                              ),
                              MockTimingRule(
                                      methods = setOf("POST"),
                                      pathType = "exact",
                                      path = "/v1/configs",
                                      timingClass = "configWrite"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "prefix",
                                      path = "/v1/configs/",
                                      timingClass = "configRead"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT"),
                                      pathType = "prefix",
                                      path = "/v1/configs/",
                                      timingClass = "configWrite"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT"),
                                      pathType = "prefix",
                                      path = "/v1/configs:",
                                      timingClass = "configWrite"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "exact",
                                      path = "/v1/drives",
                                      timingClass = "driveAction"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT", "POST"),
                                      pathType = "prefix",
                                      path = "/v1/drives/",
                                      timingClass = "driveAction"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT", "POST"),
                                      pathType = "prefix",
                                      path = "/v1/runners:",
                                      timingClass = "runner"
                              ),
                              MockTimingRule(
                                      methods = setOf("GET"),
                                      pathType = "exact",
                                      path = "/v1/machine:readmem",
                                      timingClass = "memoryRead"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT", "POST"),
                                      pathType = "exact",
                                      path = "/v1/machine:writemem",
                                      timingClass = "memoryWrite"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT"),
                                      pathType = "prefix",
                                      path = "/v1/machine:",
                                      timingClass = "machineControl"
                              ),
                              MockTimingRule(
                                      methods = setOf("PUT"),
                                      pathType = "prefix",
                                      path = "/v1/streams/",
                                      timingClass = "streamControl"
                              ),
                      ),
              faults =
                      MockTimingFaults(
                              slowExtraDelayMs = 180,
                              slowJitterRangeMs = 70,
                              timeoutMinimumDelayMs = 1500
                      ),
      )
    }

    fun fromJson(payload: JSONObject): MockTimingProfile {
      val classesObj = payload.getJSONObject("classes")
      val classMap = mutableMapOf<String, MockTimingClassConfig>()
      val classKeys = classesObj.keys()
      while (classKeys.hasNext()) {
        val classId = classKeys.next()
        val classObj = classesObj.getJSONObject(classId)
        classMap[classId] =
                MockTimingClassConfig(
                        baseDelayMs = classObj.optInt("baseDelayMs", 0),
                        jitterRangeMs = classObj.optInt("jitterRangeMs", 0),
                        jitterSeed = classObj.optInt("jitterSeed", 0),
                )
      }

      val faultsObj = payload.getJSONObject("faults")
      val rulesArray = payload.getJSONArray("rules")
      val parsedRules = mutableListOf<MockTimingRule>()
      for (index in 0 until rulesArray.length()) {
        val ruleObj = rulesArray.getJSONObject(index)
        val methodsArray = ruleObj.getJSONArray("methods")
        val methods = mutableSetOf<String>()
        for (methodIndex in 0 until methodsArray.length()) {
          methods.add(methodsArray.getString(methodIndex).trim().uppercase())
        }
        parsedRules.add(
                MockTimingRule(
                        methods = methods,
                        pathType = ruleObj.getString("pathType"),
                        path = ruleObj.getString("path"),
                        timingClass = ruleObj.getString("timingClass"),
                ),
        )
      }

      return MockTimingProfile(
              seed = payload.optInt("seed", 0),
              defaultClassId = payload.optString("defaultClassId", "default"),
              classes = classMap,
              rules = parsedRules,
              faults =
                      MockTimingFaults(
                              slowExtraDelayMs = faultsObj.optInt("slowExtraDelayMs", 0),
                              slowJitterRangeMs = faultsObj.optInt("slowJitterRangeMs", 0),
                              timeoutMinimumDelayMs =
                                      faultsObj.optInt("timeoutMinimumDelayMs", 1500),
                      ),
      )
    }
  }

  fun resolveTimingClassId(method: String, path: String): String {
    val normalizedMethod = method.trim().uppercase()
    val matchedRule =
            rules.firstOrNull { rule ->
              val methodMatches = rule.methods.contains(normalizedMethod)
              if (!methodMatches) {
                false
              } else if (rule.pathType == "exact") {
                path == rule.path
              } else {
                path.startsWith(rule.path)
              }
            }
    return matchedRule?.timingClass ?: defaultClassId
  }

  fun resolveDelayMs(method: String, path: String, requestSequence: Int): Int {
    val classId = resolveTimingClassId(method, path)
    val timingClass =
            classes[classId]
                    ?: classes[defaultClassId] ?: error("Mock timing class missing: $classId")
    val range = max(0, timingClass.jitterRangeMs)
    val jitter =
            if (range == 0) {
              0
            } else {
              val jitterSeed = seed + timingClass.jitterSeed * 13 + requestSequence * 17
              abs(jitterSeed % (range + 1))
            }
    return timingClass.baseDelayMs + jitter
  }

  fun timeoutMinimumDelayMs(): Int = faults.timeoutMinimumDelayMs
}
