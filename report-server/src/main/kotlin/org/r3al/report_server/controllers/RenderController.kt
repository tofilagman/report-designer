package org.r3al.report_server.controllers

import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.responses.ApiResponse
import io.swagger.v3.oas.annotations.tags.Tag
import org.r3al.report_server.services.RenderService
import org.r3al.report_server.services.ResponseType
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.io.InputStreamSource
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.util.Base64


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
        return renderService.render(template, dataId).toPdfString()
    }

    @Operation(summary = "render pdf based64 data from json body")
    @PostMapping("/text/{template}")
    @ApiResponse(
        content = [
            Content(
                mediaType = "text/plain",
            )
        ]
    )
    fun renderDataText(@PathVariable("template") template: String, @RequestBody data: String): String {
        return renderService.renderData(template, data).toPdfString()
    }

    @Operation(summary = "render pdf stream from json body")
    @PostMapping("/pdf/{template}")
    @ApiResponse(
        content = [
            Content(
                mediaType = "application/pdf",
            )
        ]
    )
    fun renderDataPdf(@PathVariable("template") template: String, @RequestBody data: String): ResponseEntity<ByteArray> {
        val data = renderService.renderData(template, data)

        return ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=$template.pdf")
            .contentType(MediaType.APPLICATION_PDF)
            .body(data)
    }

    private fun ByteArray.toPdfString(): String {
        return this.toBase64("application/pdf")
    }

    private fun ByteArray.toBase64(contentType: String): String {
        val str = Base64.getEncoder().encodeToString(this)
        return "data:$contentType;base64,$str"
    }
}