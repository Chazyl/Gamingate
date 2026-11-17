package com.gamingate.gateway.registry

import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SchemaValidatorsConfig
import com.networknt.schema.SpecVersion

/** Thrown when platforms.json fails schema validation; message names the field. */
class RegistryValidationException(message: String) : Exception(message)

/**
 * Bare-Kotlin, fail-closed registry validator (REG-01, both runtimes).
 *
 * Validates the SAME platforms.json against the SAME committed
 * platforms.schema.json the Electron engine is generated from. No network, no
 * registry fetch: the schema and registry are bundled assets.
 */
object RegistryValidator {

    private val mapper = ObjectMapper()

    /**
     * Validate [registryJson] against [schemaJson]; throw
     * [RegistryValidationException] naming the offending field on the first
     * violation. Returns normally only when the registry is schema-valid.
     */
    @JvmStatic
    fun validate(registryJson: String, schemaJson: String) {
        val schemaNode = mapper.readTree(schemaJson)
        val instanceNode = mapper.readTree(registryJson)

        val config = SchemaValidatorsConfig()
        config.setFormatAssertionsEnabled(true)

        val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)
        val schema = factory.getSchema(schemaNode, config)
        val errors = schema.validate(instanceNode)

        if (errors.isNotEmpty()) {
            val first = errors.first()
            throw RegistryValidationException(
                "invalid platforms.json: ${first.message} at ${first.instanceLocation}"
            )
        }
    }
}
