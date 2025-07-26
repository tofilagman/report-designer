package org.r3al.report_server.models

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class TemplateModel (
    val name: String,
    val landscape: Boolean,
    val documentType: String,
    val code: String,
    val data: String?,
    val style: String?,
    val script: String,
    val margin: Margin,
    val assets: List<Asset>
)

data class Margin(
    val left: String,
    val right: String,
    val top: String,
    val bottom: String
)

data class Asset (
    val id: String,
    val data: String
)