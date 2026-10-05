package org.r3al.report_server

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.r3al.report_server.components.ApiKeyFilter
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.options
import org.springframework.test.web.servlet.post
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

private const val KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

@SpringBootTest(properties = ["report.server.key=$KEY"])
@AutoConfigureMockMvc
class ApiKeyFilterTests {

    @Autowired
    lateinit var mvc: MockMvc

    @Test
    fun `requests without a key are rejected`() {
        mvc.get("/template").andExpect {
            status { isUnauthorized() }
            header { string("WWW-Authenticate", "Bearer realm=\"report-server\"") }
            content { string("Missing API key") }
        }
    }

    @Test
    fun `a wrong key is rejected`() {
        mvc.get("/template") { header("Authorization", "Bearer ${KEY.reversed()}") }
            .andExpect { status { isUnauthorized() }; content { string("Invalid API key") } }
    }

    @Test
    fun `the right key is accepted`() {
        mvc.get("/template") { header("Authorization", "Bearer $KEY") }.andExpect { status { isOk() } }
        mvc.get("/template") { header("Authorization", "bearer $KEY") }.andExpect { status { isOk() } }
    }

    @Test
    fun `publishing, syncing and rendering are all protected`() {
        mvc.post("/template/publish").andExpect { status { isUnauthorized() } }
        mvc.post("/lib/sync").andExpect { status { isUnauthorized() } }
        mvc.post("/render/pdf/anything") { content = "{}" }.andExpect { status { isUnauthorized() } }
        mvc.get("/render/anything/data.json").andExpect { status { isUnauthorized() } }
    }

    @Test
    fun `docs and CORS preflight stay open`() {
        mvc.get("/v3/api-docs").andExpect { status { isOk() } }
        // The key check must not answer preflight; what CORS itself returns is Spring's business.
        val preflight = mvc.options("/render/pdf/anything") {
            header("Origin", "http://example.test")
            header("Access-Control-Request-Method", "POST")
        }.andReturn().response
        assertNotEquals(401, preflight.status)
    }
}

class ApiKeyFilterConfigTests {

    @Test
    fun `short keys are refused at startup`() {
        assertThrows<IllegalStateException> { ApiKeyFilter("too-short") }
    }

    @Test
    fun `without a key the filter lets everything through`() {
        val filter = object : ApiKeyFilter("") {
            fun skips(r: MockHttpServletRequest) = shouldNotFilter(r)
        }
        assertTrue(filter.skips(MockHttpServletRequest("POST", "/template/publish")))
    }

    @Test
    fun `with a key only docs and preflight skip the check`() {
        val filter = object : ApiKeyFilter(KEY) {
            fun skips(r: MockHttpServletRequest) = shouldNotFilter(r)
        }
        assertFalse(filter.skips(MockHttpServletRequest("POST", "/template/publish")))
        assertFalse(filter.skips(MockHttpServletRequest("GET", "/docsx")))
        assertTrue(filter.skips(MockHttpServletRequest("GET", "/docs")))
        assertTrue(filter.skips(MockHttpServletRequest("GET", "/swagger-ui/index.html")))
        assertTrue(filter.skips(MockHttpServletRequest("OPTIONS", "/render/pdf/x")))
    }
}
