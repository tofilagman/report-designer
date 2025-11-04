package org.r3al.report_server.services

import org.springframework.web.multipart.MultipartFile

interface RenderService {
    fun render(templateName: String, dataId: String): ByteArray
    fun renderData(templateName: String, data: String): ByteArray
    fun uploadTemplate(file: MultipartFile)
}

enum class ResponseType() {
    PDF, TEXT
}