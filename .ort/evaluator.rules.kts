val permissiveLicenses = licenseClassifications.licensesByCategory["permissive"].orEmpty()
val copyleftLicenses = licenseClassifications.licensesByCategory["copyleft"].orEmpty()
val copyleftLimitedLicenses = licenseClassifications.licensesByCategory["copyleft-limited"].orEmpty()
val publicDomainLicenses = licenseClassifications.licensesByCategory["public-domain"].orEmpty()

val handledLicenses = listOf(
    permissiveLicenses,
    copyleftLicenses,
    copyleftLimitedLicenses,
    publicDomainLicenses
).flatten().let {
    it.getDuplicates().let { duplicates ->
        require(duplicates.isEmpty()) {
            "The classifications for the following licenses overlap: $duplicates"
        }
    }
    it.toSet()
}

fun PackageRule.howToFixDefault() = """
    Update ORT policy config by either:
    1) adding the SPDX license to .ort/license-classifications.yml, or
    2) fixing package metadata / curations in .ort.yml, or
    3) adding an explicit, justified resolution in .ort/resolutions.yml.
""".trimIndent()

fun PackageRule.LicenseRule.isHandled() =
    object : RuleMatcher {
        override val description = "isHandled($license)"

        override fun matches() =
            license in handledLicenses && ("-exception" !in license.toString() || " WITH " in license.toString())
    }

fun RuleSet.unhandledLicenseRule() = packageRule("UNHANDLED_LICENSE") {
    require {
        -isExcluded()
    }

    licenseRule("UNHANDLED_LICENSE", LicenseView.CONCLUDED_OR_DECLARED_AND_DETECTED) {
        require {
            -isExcluded()
            -isHandled()
        }

        error(
            "The license $license is not covered by project policy. " +
                "Source=$licenseSource package=${pkg.metadata.id.toCoordinates()}.",
            howToFixDefault()
        )
    }
}

fun RuleSet.unmappedDeclaredLicenseRule() = packageRule("UNMAPPED_DECLARED_LICENSE") {
    require {
        -isExcluded()
    }

    resolvedLicenseInfo.licenseInfo.declaredLicenseInfo.processed.unmapped.forEach { unmappedLicense ->
        error(
            "Declared license '$unmappedLicense' cannot be mapped to SPDX for package " +
                "${pkg.metadata.id.toCoordinates()}.",
            howToFixDefault()
        )
    }
}

val ruleSet = ruleSet(ortResult, licenseInfoResolver, resolutionProvider) {
    unhandledLicenseRule()
    unmappedDeclaredLicenseRule()
}

ruleViolations += ruleSet.violations
