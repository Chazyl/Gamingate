package com.gamingate.gateway.registry

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM proof of REG-01 on the Android runtime: the committed schema accepts the
 * real platforms.json and rejects an invalid packet fail-closed, naming a field.
 *
 * Reads the registry tree from `gamingate.registry.dir` (set by app/build.gradle),
 * so a single source of truth feeds both the TS drift guard and this test.
 */
class RegistryValidatorTest {

    private val registryDir: File
        get() = File(
            requireNotNull(System.getProperty("gamingate.registry.dir")) {
                "gamingate.registry.dir system property is not set"
            }
        )

    private fun read(relative: String): String = File(registryDir, relative).readText()

    @Test
    fun validRegistryPasses() {
        RegistryValidator.validate(
            read("platforms.json"),
            read("platforms.schema.json")
        )
    }

    @Test
    fun invalidRegistryFailsClosedNamingTheField() {
        try {
            RegistryValidator.validate(
                read("test/fixtures/invalid-platforms.json"),
                read("platforms.schema.json")
            )
            fail("expected RegistryValidationException for an invalid packet")
        } catch (expected: RegistryValidationException) {
            assertTrue(
                "error should name the offending field: ${expected.message}",
                expected.message!!.contains("entryUrl")
            )
        }
    }
}
