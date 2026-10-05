package org.r3al.report_server.components

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.security.MessageDigest

/**
 * Requires `Authorization: Bearer <key>` on every API call when a key is configured.
 *
 * The key comes from the REPORT_SERVER_KEY environment variable (or the `report.server.key`
 * property). Generate one with `openssl rand -hex 32`. Without a key the server stays open,
 * so existing deployments keep working until a key is added, and a warning is logged.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
open class ApiKeyFilter(@Value("\${report.server.key:}") key: String) : OncePerRequestFilter() {

    companion object {
        const val MIN_KEY_LENGTH = 32
        private val OPEN_PATHS = listOf("/docs", "/swagger-ui", "/v3/api-docs")
    }

    private val log = LoggerFactory.getLogger(ApiKeyFilter::class.java)
    private val expected: ByteArray? = key.trim().takeIf { it.isNotEmpty() }?.toByteArray(Charsets.UTF_8)

    init {
        if (expected == null) {
            log.warn("REPORT_SERVER_KEY is not set: publishing, library sync and rendering are open to anyone who can reach this server")
        } else {
            check(expected.size >= MIN_KEY_LENGTH) {
                "REPORT_SERVER_KEY must be at least $MIN_KEY_LENGTH characters; generate one with: openssl rand -hex 32"
            }
            log.info("API key authentication enabled")
        }
    }

    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        if (expected == null) return true
        // CORS preflight carries no credentials; the real request that follows is checked.
        if (request.method == "OPTIONS") return true
        val path = request.requestURI.removePrefix(request.contextPath)
        return OPEN_PATHS.any { path == it || path.startsWith("$it/") || path.startsWith("$it.") }
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val presented = bearer(request)?.toByteArray(Charsets.UTF_8)
        // Constant-time comparison, so response timing doesn't reveal how much of a guess matched.
        if (presented != null && MessageDigest.isEqual(presented, expected)) {
            chain.doFilter(request, response)
            return
        }
        log.warn("Rejected {} {} from {}: {}", request.method, request.requestURI, request.remoteAddr,
            if (presented == null) "no API key" else "wrong API key")
        response.status = HttpStatus.UNAUTHORIZED.value()
        response.setHeader("WWW-Authenticate", "Bearer realm=\"report-server\"")
        response.contentType = "text/plain;charset=UTF-8"
        response.writer.write(if (presented == null) "Missing API key" else "Invalid API key")
    }

    private fun bearer(request: HttpServletRequest): String? {
        val header = request.getHeader("Authorization") ?: return null
        if (!header.regionMatches(0, "Bearer ", 0, 7, ignoreCase = true)) return null
        return header.substring(7).trim().takeIf { it.isNotEmpty() }
    }
}
