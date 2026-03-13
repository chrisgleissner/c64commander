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
                        return fromJson(
                                JSONObject(
                                        """
        {
          "version": 1,
          "seed": 19,
          "defaultClassId": "default",
          "faults": {
            "slowExtraDelayMs": 180,
            "slowJitterRangeMs": 70,
            "timeoutMinimumDelayMs": 1500
          },
          "classes": {
            "optionsRoot": { "baseDelayMs": 28, "jitterRangeMs": 9, "jitterSeed": 11 },
            "versionRead": { "baseDelayMs": 13, "jitterRangeMs": 22, "jitterSeed": 12 },
            "infoRead": { "baseDelayMs": 11, "jitterRangeMs": 6, "jitterSeed": 13 },
            "runnerSidplayPut": { "baseDelayMs": 413, "jitterRangeMs": 48, "jitterSeed": 21 },
            "runnerSidplayPost": { "baseDelayMs": 391, "jitterRangeMs": 58, "jitterSeed": 22 },
            "runnerModplayPut": { "baseDelayMs": 192, "jitterRangeMs": 34, "jitterSeed": 23 },
            "runnerModplayPost": { "baseDelayMs": 156, "jitterRangeMs": 10, "jitterSeed": 24 },
            "runnerLoadPrgPut": { "baseDelayMs": 574, "jitterRangeMs": 11, "jitterSeed": 25 },
            "runnerLoadPrgPost": { "baseDelayMs": 570, "jitterRangeMs": 18, "jitterSeed": 26 },
            "runnerRunPrgPut": { "baseDelayMs": 1986, "jitterRangeMs": 10, "jitterSeed": 27 },
            "runnerRunPrgPost": { "baseDelayMs": 1988, "jitterRangeMs": 11, "jitterSeed": 28 },
            "runnerRunCrtPut": { "baseDelayMs": 291, "jitterRangeMs": 7, "jitterSeed": 29 },
            "runnerRunCrtPost": { "baseDelayMs": 289, "jitterRangeMs": 6, "jitterSeed": 30 },
            "configsListRead": { "baseDelayMs": 14, "jitterRangeMs": 8, "jitterSeed": 31 },
            "configsCategoryRead": { "baseDelayMs": 16, "jitterRangeMs": 14, "jitterSeed": 32 },
            "configsItemRead": { "baseDelayMs": 20, "jitterRangeMs": 6, "jitterSeed": 33 },
            "configsBatchWrite": { "baseDelayMs": 54, "jitterRangeMs": 16, "jitterSeed": 34 },
            "configsItemWrite": { "baseDelayMs": 12, "jitterRangeMs": 6, "jitterSeed": 35 },
            "configsLoadFromFlashWrite": { "baseDelayMs": 42, "jitterRangeMs": 21, "jitterSeed": 36 },
            "configsSaveToFlashWrite": { "baseDelayMs": 10, "jitterRangeMs": 8, "jitterSeed": 37 },
            "configsResetToDefaultWrite": { "baseDelayMs": 58, "jitterRangeMs": 12, "jitterSeed": 38 },
            "machineResetWrite": { "baseDelayMs": 18, "jitterRangeMs": 8, "jitterSeed": 41 },
            "machineRebootWrite": { "baseDelayMs": 24, "jitterRangeMs": 12, "jitterSeed": 42 },
            "machinePauseWrite": { "baseDelayMs": 10, "jitterRangeMs": 9, "jitterSeed": 43 },
            "machineResumeWrite": { "baseDelayMs": 11, "jitterRangeMs": 12, "jitterSeed": 44 },
            "machinePoweroffWrite": { "baseDelayMs": 18, "jitterRangeMs": 8, "jitterSeed": 45 },
            "machineMenuButtonWrite": { "baseDelayMs": 11, "jitterRangeMs": 5, "jitterSeed": 46 },
            "machineWritememPut": { "baseDelayMs": 11, "jitterRangeMs": 5, "jitterSeed": 47 },
            "machineWritememPost": { "baseDelayMs": 52, "jitterRangeMs": 9, "jitterSeed": 48 },
            "machineReadmemRead": { "baseDelayMs": 12, "jitterRangeMs": 8, "jitterSeed": 49 },
            "machineDebugregRead": { "baseDelayMs": 10, "jitterRangeMs": 10, "jitterSeed": 50 },
            "machineDebugregWrite": { "baseDelayMs": 10, "jitterRangeMs": 14, "jitterSeed": 51 },
            "driveListRead": { "baseDelayMs": 17, "jitterRangeMs": 6, "jitterSeed": 61 },
            "driveMountPut": { "baseDelayMs": 744, "jitterRangeMs": 21, "jitterSeed": 62 },
            "driveMountPost": { "baseDelayMs": 1110, "jitterRangeMs": 30, "jitterSeed": 63 },
            "driveReset": { "baseDelayMs": 18, "jitterRangeMs": 8, "jitterSeed": 64 },
            "driveRemove": { "baseDelayMs": 100, "jitterRangeMs": 25, "jitterSeed": 65 },
            "drivePower": { "baseDelayMs": 10, "jitterRangeMs": 6, "jitterSeed": 66 },
            "driveLoadRomPut": { "baseDelayMs": 52, "jitterRangeMs": 12, "jitterSeed": 67 },
            "driveLoadRomPost": { "baseDelayMs": 66, "jitterRangeMs": 12, "jitterSeed": 68 },
            "driveSetMode": { "baseDelayMs": 110, "jitterRangeMs": 15, "jitterSeed": 69 },
            "streamStart": { "baseDelayMs": 1015, "jitterRangeMs": 12, "jitterSeed": 71 },
            "streamStop": { "baseDelayMs": 10, "jitterRangeMs": 10, "jitterSeed": 72 },
            "fileInfoRead": { "baseDelayMs": 31, "jitterRangeMs": 12, "jitterSeed": 81 },
            "fileCreateD64": { "baseDelayMs": 180, "jitterRangeMs": 25, "jitterSeed": 82 },
            "fileCreateD71": { "baseDelayMs": 511, "jitterRangeMs": 120, "jitterSeed": 83 },
            "fileCreateD81": { "baseDelayMs": 851, "jitterRangeMs": 35, "jitterSeed": 84 },
            "fileCreateDnp": { "baseDelayMs": 982, "jitterRangeMs": 35, "jitterSeed": 85 },
            "default": { "baseDelayMs": 18, "jitterRangeMs": 14, "jitterSeed": 10 }
          },
          "rules": [
            { "methods": ["OPTIONS"], "pathType": "exact", "path": "/", "timingClass": "optionsRoot" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/version", "timingClass": "versionRead" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/info", "timingClass": "infoRead" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/runners:sidplay", "timingClass": "runnerSidplayPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/runners:sidplay", "timingClass": "runnerSidplayPost" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/runners:modplay", "timingClass": "runnerModplayPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/runners:modplay", "timingClass": "runnerModplayPost" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/runners:load_prg", "timingClass": "runnerLoadPrgPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/runners:load_prg", "timingClass": "runnerLoadPrgPost" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/runners:run_prg", "timingClass": "runnerRunPrgPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/runners:run_prg", "timingClass": "runnerRunPrgPost" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/runners:run_crt", "timingClass": "runnerRunCrtPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/runners:run_crt", "timingClass": "runnerRunCrtPost" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/configs", "timingClass": "configsListRead" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/configs", "timingClass": "configsBatchWrite" },
            { "methods": ["GET"], "pathType": "regex", "path": "^/v1/configs/[^/]+$", "timingClass": "configsCategoryRead" },
            { "methods": ["GET"], "pathType": "regex", "path": "^/v1/configs/[^/]+/[^/]+$", "timingClass": "configsItemRead" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/configs/[^/]+/[^/]+$", "timingClass": "configsItemWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/configs:load_from_flash", "timingClass": "configsLoadFromFlashWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/configs:save_to_flash", "timingClass": "configsSaveToFlashWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/configs:reset_to_default", "timingClass": "configsResetToDefaultWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:reset", "timingClass": "machineResetWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:reboot", "timingClass": "machineRebootWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:pause", "timingClass": "machinePauseWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:resume", "timingClass": "machineResumeWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:poweroff", "timingClass": "machinePoweroffWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:menu_button", "timingClass": "machineMenuButtonWrite" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:writemem", "timingClass": "machineWritememPut" },
            { "methods": ["POST"], "pathType": "exact", "path": "/v1/machine:writemem", "timingClass": "machineWritememPost" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/machine:readmem", "timingClass": "machineReadmemRead" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/machine:debugreg", "timingClass": "machineDebugregRead" },
            { "methods": ["PUT"], "pathType": "exact", "path": "/v1/machine:debugreg", "timingClass": "machineDebugregWrite" },
            { "methods": ["GET"], "pathType": "exact", "path": "/v1/drives", "timingClass": "driveListRead" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:mount$", "timingClass": "driveMountPut" },
            { "methods": ["POST"], "pathType": "regex", "path": "^/v1/drives/[^/]+:mount$", "timingClass": "driveMountPost" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:reset$", "timingClass": "driveReset" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:remove$", "timingClass": "driveRemove" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:(on|off)$", "timingClass": "drivePower" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:load_rom$", "timingClass": "driveLoadRomPut" },
            { "methods": ["POST"], "pathType": "regex", "path": "^/v1/drives/[^/]+:load_rom$", "timingClass": "driveLoadRomPost" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/drives/[^/]+:set_mode$", "timingClass": "driveSetMode" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/streams/[^/]+:start$", "timingClass": "streamStart" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/streams/[^/]+:stop$", "timingClass": "streamStop" },
            { "methods": ["GET"], "pathType": "regex", "path": "^/v1/files/.+:info$", "timingClass": "fileInfoRead" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/files/.+:create_d64$", "timingClass": "fileCreateD64" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/files/.+:create_d71$", "timingClass": "fileCreateD71" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/files/.+:create_d81$", "timingClass": "fileCreateD81" },
            { "methods": ["PUT"], "pathType": "regex", "path": "^/v1/files/.+:create_dnp$", "timingClass": "fileCreateDnp" }
          ]
        }
        """.trimIndent(),
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
                                        methods.add(
                                                methodsArray
                                                        .getString(methodIndex)
                                                        .trim()
                                                        .uppercase()
                                        )
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
                                                slowExtraDelayMs =
                                                        faultsObj.optInt("slowExtraDelayMs", 0),
                                                slowJitterRangeMs =
                                                        faultsObj.optInt("slowJitterRangeMs", 0),
                                                timeoutMinimumDelayMs =
                                                        faultsObj.optInt(
                                                                "timeoutMinimumDelayMs",
                                                                1500
                                                        ),
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
                                } else if (rule.pathType == "prefix") {
                                        path.startsWith(rule.path)
                                } else {
                                        Regex(rule.path).matches(path)
                                }
                        }
                return matchedRule?.timingClass ?: defaultClassId
        }

        fun resolveDelayMs(method: String, path: String, requestSequence: Int): Int {
                val classId = resolveTimingClassId(method, path)
                val timingClass =
                        classes[classId]
                                ?: classes[defaultClassId]
                                        ?: error("Mock timing class missing: $classId")
                val range = max(0, timingClass.jitterRangeMs)
                val jitter =
                        if (range == 0) {
                                0
                        } else {
                                val jitterSeed =
                                        seed + timingClass.jitterSeed * 13 + requestSequence * 17
                                abs(jitterSeed % (range + 1))
                        }
                return timingClass.baseDelayMs + jitter
        }

        fun timeoutMinimumDelayMs(): Int = faults.timeoutMinimumDelayMs
}
