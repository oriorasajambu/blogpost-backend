package com.blogpost.contract.wire

import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import java.math.BigDecimal
import java.net.URI
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** Validates the checked-in wire shapes before Gson can coerce values or inject missing nulls. */
internal object WireContract {
    private val document: JsonObject = WireContract::class.java.classLoader
        .getResourceAsStream("blogpost-wire-v1.json")!!.bufferedReader(Charsets.UTF_8)
        .use { WireJson.parse(it.readText()).asJsonObject }
    private val schemas = document.getAsJsonObject("schemas")
    private val operations = document.getAsJsonObject("operations")
    private val regexes = ConcurrentHashMap<String, Regex>()
    private val compatibleVersion = Regex("^1\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$")
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    // Matches the pinned backend AJV full-mode email format, including dot-atom local parts.
    private val email = Regex("""^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$""", RegexOption.IGNORE_CASE)

    /** Returns immutable operation rules; unknown operation IDs fail closed. */
    fun operation(id: String): JsonObject = operations[id]?.asJsonObject ?: throw WireProtocolException()

    /** Validates and reads a successful envelope before constructing its generated DTO. */
    fun success(id: String, value: JsonElement): Pair<WireMetadata, WireSafety> {
        val rule = operation(id)
        if (rule["binary"].asBoolean) throw WireProtocolException()
        val unsupported = linkedSetOf<String>()
        validate(rule["response"].asJsonObject, value, "", response = true, unsupported)
        val root = value.asJsonObject
        val meta = metadata(root)
        val rawActions = root["data"].takeIf { it.isJsonObject }?.asJsonObject
            ?.getAsJsonArray("allowedActions")?.map { it.asString } ?: emptyList()
        val safety = WireSafety(unsupported.toSet(), emptySet())
        return meta to safety.copy(allowedActions = safety.actionsFor(rawActions))
    }

    /** Validates non-2xx bodies with the same required envelope/DTO rules as successful responses. */
    fun error(value: JsonElement): Pair<WireMetadata, WireProblem> {
        validate(schemas["ErrorEnvelope"].asJsonObject, value, "", true, linkedSetOf())
        val root = value.asJsonObject
        val meta = metadata(root)
        val error = root.getAsJsonObject("error")
        val issues = error.getAsJsonArray("fieldErrors").map { part ->
            val issue = part.asJsonObject
            WireFieldIssue(issue["location"].asString, issue["field"].asString, issue["code"].asString,
                issue.getAsJsonObject("params").entrySet().associate { it.key to it.value.deepCopy() })
        }
        val context = error["context"].takeIf { it.isJsonObject }?.asJsonObject
        val current = context?.get("currentVersion")?.takeIf { isInteger(it) }
            ?.asBigDecimal?.takeIf { it >= BigDecimal.ONE && it <= BigDecimal(Int.MAX_VALUE) }?.toInt()
        val resource = context?.get("resourceId")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
            ?.asString?.takeIf { uuid.matches(it) }
        return meta to WireProblem(error["code"].asString, meta.traceId, issues, current, resource)
    }

    /** Preserves required nulls while omitting optional nulls unless the caller explicitly selected them. */
    fun request(id: String, value: JsonElement, explicitNullFields: Set<String>): JsonElement {
        val schema = operation(id)["request"].takeUnless { it.isJsonNull }?.asJsonObject
            ?: throw WireInputException()
        val found = mutableSetOf<String>()
        fun prune(rule: JsonObject, item: JsonElement, path: String) {
            val resolved = resolve(rule)
            if (item.isJsonObject) {
                val properties = resolved.getAsJsonObject("properties") ?: return
                val required = resolved.getAsJsonArray("required")?.map { it.asString }?.toSet() ?: emptySet()
                for ((name, childRule) in properties.entrySet()) {
                    if (!item.asJsonObject.has(name)) continue
                    val pointer = "$path/${escape(name)}"
                    val child = item.asJsonObject[name]
                    if (pointer in explicitNullFields) {
                        if (!child.isJsonNull) throw WireInputException()
                        found.add(pointer)
                    }
                    if (child.isJsonNull && name !in required && pointer !in explicitNullFields) item.asJsonObject.remove(name)
                    else prune(childRule.asJsonObject, child, pointer)
                }
            } else if (item.isJsonArray && resolved.has("items"))
                item.asJsonArray.forEachIndexed { index, child -> prune(resolved["items"].asJsonObject, child, "$path/$index") }
        }
        try {
            prune(schema, value, "")
            if (!found.containsAll(explicitNullFields)) throw WireInputException()
            validate(schema, value, "", false, linkedSetOf())
        } catch (_: WireProtocolException) { throw WireInputException() }
        return value
    }

    private fun resolve(schema: JsonObject): JsonObject {
        val reference = schema["$" + "ref"] ?: return schema
        val pointer = reference.asString
        if (!pointer.startsWith("#/components/schemas/")) throw WireProtocolException()
        return resolve(schemas[pointer.substringAfterLast('/')]?.asJsonObject ?: throw WireProtocolException())
    }
    private fun isInteger(value: JsonElement): Boolean = value.isJsonPrimitive &&
        value.asJsonPrimitive.isNumber && value.asBigDecimal.stripTrailingZeros().scale() <= 0
    private fun escape(value: String): String = value.replace("~", "~0").replace("/", "~1")
    private fun scalarText(value: String): Boolean {
        var index = 0
        while (index < value.length) {
            val part = value[index++]
            if (part.isHighSurrogate()) { if (index >= value.length || !value[index++].isLowSurrogate()) return false }
            else if (part.isLowSurrogate()) return false
        }
        return true
    }
    private fun validate(schema: JsonObject, value: JsonElement, path: String, response: Boolean, unsupported: MutableSet<String>) {
        if (schema.has("$" + "ref")) {
            validate(resolve(schema), value, path, response, unsupported)
            if (schema.size() > 1) validate(schema.deepCopy().apply { remove("$" + "ref") },
                value, path, response, unsupported)
            return
        }
        fun test(rule: JsonObject): Set<String>? {
            val warnings = linkedSetOf<String>()
            return try { validate(rule, value, path, response, warnings); warnings }
            catch (_: WireProtocolException) { null }
        }
        for (kind in listOf("anyOf", "oneOf")) if (schema.has(kind)) {
            val matches = schema.getAsJsonArray(kind).mapNotNull { test(it.asJsonObject) }
            if (matches.isEmpty() || (kind == "oneOf" && matches.size != 1)) throw WireProtocolException()
            unsupported.addAll(matches.first())
        }
        schema.getAsJsonArray("allOf")?.forEach { validate(it.asJsonObject, value, path, response, unsupported) }
        if (schema.has("not") && test(schema["not"].asJsonObject) != null) throw WireProtocolException()
        if (schema.has("if")) {
            val branch = if (test(schema["if"].asJsonObject) != null) "then" else "else"
            schema[branch]?.let { validate(it.asJsonObject, value, path, response, unsupported) }
        }
        val declared = schema["type"]
        if (declared != null) {
            val types = if (declared.isJsonArray) declared.asJsonArray.map { it.asString } else listOf(declared.asString)
            val valid = types.any { type -> when (type) {
                "null" -> value.isJsonNull
                "object" -> value.isJsonObject
                "array" -> value.isJsonArray
                "string" -> value.isJsonPrimitive && value.asJsonPrimitive.isString
                "boolean" -> value.isJsonPrimitive && value.asJsonPrimitive.isBoolean
                "integer" -> isInteger(value)
                "number" -> value.isJsonPrimitive && value.asJsonPrimitive.isNumber
                else -> false
            } }
            if (!valid) throw WireProtocolException()
        }
        if (schema.has("const") && value != schema["const"]) {
            when {
                response && path.endsWith("/markdownContractVersion") && isInteger(value) && value.asBigDecimal > BigDecimal.ZERO -> unsupported.add(path)
                response && path.endsWith("/contractVersion") && value.isJsonPrimitive && value.asJsonPrimitive.isString && compatible(value.asString) -> Unit
                response && path.startsWith("/data/limits/") && isInteger(value) && value.asBigDecimal > BigDecimal.ZERO -> Unit
                else -> throw WireProtocolException()
            }
        }
        schema.getAsJsonArray("enum")?.let { allowed ->
            if (allowed.none { it == value }) {
                if (response && value.isJsonPrimitive && value.asJsonPrimitive.isString) unsupported.add(path)
                else throw WireProtocolException()
            }
        }
        if (value.isJsonNull) return
        if (value.isJsonObject) {
            val properties = schema.getAsJsonObject("properties")
            schema.getAsJsonArray("required")?.forEach { if (!value.asJsonObject.has(it.asString)) throw WireProtocolException() }
            val size = value.asJsonObject.size()
            if (schema["minProperties"]?.asInt?.let { size < it } == true || schema["maxProperties"]?.asInt?.let { size > it } == true) throw WireProtocolException()
            if (!response && schema["additionalProperties"]?.let { it.isJsonPrimitive && !it.asBoolean } == true &&
                value.asJsonObject.keySet().any { properties?.has(it) != true }) throw WireProtocolException()
            properties?.entrySet()?.forEach { (name, rule) ->
                if (value.asJsonObject.has(name)) validate(rule.asJsonObject, value.asJsonObject[name], "$path/${escape(name)}", response, unsupported)
            }
        } else if (value.isJsonArray) {
            val size = value.asJsonArray.size()
            if (schema["minItems"]?.asInt?.let { size < it } == true || schema["maxItems"]?.asInt?.let { size > it } == true) throw WireProtocolException()
            if (schema["uniqueItems"]?.asBoolean == true && value.asJsonArray.toList().toSet().size != size) throw WireProtocolException()
            schema["contains"]?.asJsonObject?.let { contains ->
                var matches = 0
                value.asJsonArray.forEachIndexed { index, child ->
                    val warnings = linkedSetOf<String>()
                    try {
                        validate(contains, child, "$path/$index", response, warnings)
                        matches++
                        unsupported.addAll(warnings)
                    } catch (_: WireProtocolException) { /* This item does not satisfy contains. */ }
                }
                if (matches < (schema["minContains"]?.asInt ?: 1) ||
                    schema["maxContains"]?.asInt?.let { matches > it } == true) throw WireProtocolException()
            }
            schema["items"]?.asJsonObject?.let { item -> value.asJsonArray.forEachIndexed { index, child -> validate(item, child, "$path/$index", response, unsupported) } }
        } else if (value.asJsonPrimitive.isString) {
            val text = value.asString
            val length = text.codePointCount(0, text.length)
            if (schema["minLength"]?.asInt?.let { length < it } == true || schema["maxLength"]?.asInt?.let { length > it } == true) throw WireProtocolException()
            if (schema["x-unicodeScalarText"]?.asBoolean == true && !scalarText(text)) throw WireProtocolException()
            if (schema["x-maxUtf8Bytes"]?.asInt?.let { text.toByteArray(Charsets.UTF_8).size > it } == true) throw WireProtocolException()
            schema["pattern"]?.asString?.let { pattern -> if (!regexes.computeIfAbsent(pattern) { Regex(it) }.containsMatchIn(text)) throw WireProtocolException() }
            when (schema["format"]?.asString) {
                "uuid" -> if (!uuid.matches(text)) throw WireProtocolException()
                "date-time" -> try { Instant.parse(text) } catch (_: Exception) { throw WireProtocolException() }
                "uri" -> try { if (!URI(text).isAbsolute) throw WireProtocolException() } catch (_: Exception) { throw WireProtocolException() }
                "email" -> if (!email.matches(text)) throw WireProtocolException()
            }
        } else if (value.asJsonPrimitive.isNumber) {
            val number = value.asBigDecimal
            if (schema["minimum"]?.asBigDecimal?.let { number < it } == true || schema["maximum"]?.asBigDecimal?.let { number > it } == true) throw WireProtocolException()
            if (declared?.let { it.isJsonPrimitive && it.asString == "integer" } == true &&
                (number < BigDecimal(Int.MIN_VALUE) || number > BigDecimal(Int.MAX_VALUE))) throw WireProtocolException()
        }
    }

    private fun metadata(root: JsonObject): WireMetadata {
        val meta = root.getAsJsonObject("meta")
        val version = meta["contractVersion"].asString
        if (!compatible(version)) throw WireProtocolException()
        val idempotency = meta["idempotency"].takeIf { it.isJsonObject }?.asJsonObject
        return WireMetadata(root["timestamp"].asString, root["statusCode"].asInt,
            root["traceId"].asString, version, idempotency?.get("replayed")?.asBoolean ?: false,
            idempotency?.get("expiresAt")?.asString, meta["pagination"].takeUnless { it.isJsonNull }?.deepCopy())
    }

    /** Reads a single mutable resource's version without exposing workspace versions publicly. */
    fun resourceVersion(id: String, root: JsonElement): Int? {
        if (!operation(id)["resourceVersion"].asBoolean) return null
        val data = root.asJsonObject.getAsJsonObject("data")
        val value = data["version"] ?: data.getAsJsonObject("invitation")?.get("version")
        if (value == null || !isInteger(value) || value.asBigDecimal < BigDecimal.ONE ||
            value.asBigDecimal > BigDecimal(Int.MAX_VALUE)) throw WireProtocolException()
        return value.asInt
    }

    /** Verifies a binary response's compatible version without inventing an envelope. */
    fun compatible(version: String): Boolean {
        if (version.length > 64 || !compatibleVersion.matches(version)) return false
        val prerelease = version.substringBefore('+').substringAfter('-', "")
        return prerelease.isEmpty() || prerelease.split('.').all { part ->
            part.any { !it.isDigit() } || part == "0" || !part.startsWith('0')
        }
    }
}
