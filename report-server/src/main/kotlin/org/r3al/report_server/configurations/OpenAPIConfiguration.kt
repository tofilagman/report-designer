package org.r3al.report_server.configurations

import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.info.License
import io.swagger.v3.oas.models.security.SecurityRequirement
import io.swagger.v3.oas.models.security.SecurityScheme
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration


@Configuration
class OpenAPIConfiguration {

    @Value("\${spring.application.name}")
    lateinit var appName: String

    @Bean
    fun openAPI(): OpenAPI? {
        return OpenAPI()
            .components(
                Components().addSecuritySchemes(
                    "apiKey",
                    SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .description("The server's REPORT_SERVER_KEY")
                )
            )
            .addSecurityItem(SecurityRequirement().addList("apiKey"))
            .info(
                Info().title(appName)
                    .description(appName)
                    .version("v0.0.1")
                    .license(License().name("Apache 2.0").url("http://springdoc.org"))
            )
    }

}