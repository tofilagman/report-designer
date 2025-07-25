package org.r3al.report_server.configurations

import com.ruiyun.jvppeteer.cdp.entities.FetcherOptions
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.boot.web.servlet.server.ConfigurableServletWebServerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource

@Configuration
class WebServerConfiguration : WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> {

    val logger = LoggerFactory.getLogger(WebServerConfiguration::class.java)

    @Value("\${server.port}")
    private val port: Int = 0

    override fun customize(factory: ConfigurableServletWebServerFactory) {
        val mprt = System.getenv("PORT")?.toIntOrNull() ?: port
        logger.info("Port: $mprt")
        factory.setPort(mprt)
    }

    @Bean
    fun corsConfigurationSource(): CorsConfigurationSource {
        val configuration = CorsConfiguration()
        configuration.allowedOrigins = listOf("*")
        configuration.allowedMethods = listOf("*")
        configuration.allowedHeaders = listOf("*")
        val source = UrlBasedCorsConfigurationSource()
        source.registerCorsConfiguration("/**", configuration)
        return source
    }
}