package org.r3al.report_server.services

import org.springframework.web.multipart.MultipartFile

interface RenderService {
    fun render(templateName: String, dataId: String): String
    fun renderData(templateName: String, data: String): String
    fun uploadTemplate(file: MultipartFile)
}