package org.r3al.report_server.controllers

import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.tags.Tag
import org.r3al.report_server.services.RenderService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.web.bind.annotation.*


@RestController
@RequestMapping("/render")
@Tag(name = "render", description = "Render API")
class RenderController {

    @Autowired
    lateinit var renderService: RenderService

    @Operation(summary = "render pdf")
    @GetMapping("/{template}/{dataId}")
    @ApiResponse(
        content = [
            Content(
                mediaType = "text/plain",
            )
        ]
    )
    fun render(@PathVariable("template") template: String, @PathVariable("dataId") dataId: String): String {
        return renderService.render(template, dataId)
    }

    @Operation(summary = "render pdf from json body")
    @PostMapping("/{template}")
    @ApiResponse(
        content = [
            Content(
                mediaType = "text/plain",
            )
        ]
    )
    fun renderData(@PathVariable("template") template: String, @RequestBody data: String): String {
        return renderService.renderData(template, data)
    }
}