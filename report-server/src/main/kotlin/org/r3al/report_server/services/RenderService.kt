package org.r3al.report_server.services

interface RenderService {
    fun render(templateName: String, dataId: String): String
    fun renderData(templateName: String, data: String): String
}