package org.r3al.report_server.controllers

import io.swagger.v3.oas.annotations.Operation
import io.swagger.v3.oas.annotations.tags.Tag
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.ModelAttribute
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/template")
@Tag(name = "template", description = "Template API")
class TemplateController {

    @Operation(summary = "upload GCash")
    @PostMapping("/uploadGCash", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(@ModelAttribute file: MultipartFile) {
//        val fis = ImageIO.read(file.inputStream)
//        val parseGcash = fis.parseGCash()
//        val fname = fis.toBase64(FilenameUtils.getExtension(file.originalFilename))
//        return parseGcash.apply {
//            image = fname
//        }
    }
}