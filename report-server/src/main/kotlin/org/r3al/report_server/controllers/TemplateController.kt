package org.r3al.report_server.controllers

import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.tags.Tag
import org.r3al.report_server.services.RenderService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.ModelAttribute
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/template")
@Tag(name = "template", description = "Template API")
class TemplateController {

    @Autowired
    lateinit var renderService: RenderService

    @Operation(summary = "test connect")
    @GetMapping
    fun testConnect(): ResponseEntity<Void> {
        return ResponseEntity.status(HttpStatus.OK).build();
    }

    @Operation(summary = "publish")
    @PostMapping("/publish", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun publish(@ModelAttribute file: MultipartFile): ResponseEntity<Void> {
        renderService.uploadTemplate(file)
        return ResponseEntity.status(HttpStatus.OK).build();
    }
}