package org.r3al.report_server.services.impl

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.SerializationFeature
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.KotlinModule
import com.ruiyun.jvppeteer.api.core.Browser
import com.ruiyun.jvppeteer.api.core.Page
import com.ruiyun.jvppeteer.cdp.core.Puppeteer
import com.ruiyun.jvppeteer.cdp.entities.*
import org.bson.Document
import org.bson.RawBsonDocument
import org.r3al.report_server.components.GlobalDataManager
import org.r3al.report_server.models.TemplateModel
import org.r3al.report_server.services.RenderService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import java.io.File
import java.io.FileOutputStream
import java.util.*
import kotlin.io.path.Path


@Service
class RenderServiceImpl : RenderService {

    private val logger = LoggerFactory.getLogger(RenderServiceImpl::class.java)

    companion object {
        val tempPath = "temp"
        val dataPath = "$tempPath/data"
        val reportPath = "$tempPath/report"
        val libs = "$tempPath/libs"
    }

    @Autowired
    lateinit var dataManager: GlobalDataManager

    override fun render(templateName: String, dataId: String): ByteArray {
        val data = Path(dataPath, dataId).toFile()

        if (!data.exists())
            throw Error("Requested data doesn't exists")

        return renderData(templateName, data.readText())
    }

    override fun renderData(templateName: String, data: String): ByteArray {
        val template = Path(reportPath, "$templateName.zrpt").toFile()

        if (!template.exists())
            throw Error("Requested template doesn't exists")


        val nd = template.readBytes()
        val rawBson = RawBsonDocument(nd)
        val doc = Document(rawBson)
        val json = doc.toJson()
        val tmpl = json.jsonToObject(TemplateModel::class.java)

        val pdf = plot(tmpl, data)

        return pdf
    }

    override fun uploadTemplate(file: MultipartFile) {
        logger.info("uploading template ${file.originalFilename}")

        val folder = File(reportPath)
        if (!folder.exists()) {
            if (!folder.mkdir()) {
                throw Error("Path $reportPath doesn't exists and couldn't created")
            }
        }

        val template = Path(reportPath, file.originalFilename!!).toFile()

        if (template.exists())
            template.delete()

        val bts = file.bytes
        template.writeBytes(bts)

        logger.info("uploading template ${file.originalFilename} completed")
    }

    private fun plot(template: TemplateModel, data: String): ByteArray {
        val launchOptions = LaunchOptions.builder()
        launchOptions.executablePath(dataManager.executablePath)
        launchOptions.headless(true)
        val args = ArrayList<String?>()
        args.add("--no-sandbox")
        launchOptions.args(args)
        val cdpBrowser: Browser = Puppeteer.launch(launchOptions.build())
        val page: Page = cdpBrowser.newPage()


        val default_style = """
         body {
            font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;
        }   
        """.trimIndent()

        page.setContent(
            """
            <style id='def-style'>
                ${default_style}
              </style>
              <body></body>
        """.trimIndent()
        )

        page.addScriptTag(FrameAddScriptTagOptions().apply {
            this.id = "entry-template"
            this.type = "text/x-handlebars-template"
            this.content = template.code
        })

        if (template.style?.isNotEmpty() == true)
            page.addScriptTag(FrameAddScriptTagOptions().apply {
                this.id = "style-template"
                this.type = "text/x-handlebars-template"
                this.content = template.style
            })

        //read all js in libs folder
        val pbs = Path(libs).toFile()
        val lbs = if (pbs.exists()) {
            pbs.listFiles()
        } else null

        lbs?.filter { it.name != "Processor.js" }?.forEach { fs ->
            page.addScriptTag(FrameAddScriptTagOptions().apply {
                this.type = "text/javascript"
                this.content = fs.readText()
            })
        }

        page.addScriptTag(FrameAddScriptTagOptions().apply {
            this.type = "text/javascript"
            this.content = "window.processContext = $data"
        })

        val maps = template.assets.associate { it.id to it.data }
        if (maps.isNotEmpty()) {
            val jsMaps = maps.objectToJson()
            page.addScriptTag(FrameAddScriptTagOptions().apply {
                this.type = "text/javascript"
                this.content = "window.resourceContext = $jsMaps"
            })
        }

        page.addScriptTag(FrameAddScriptTagOptions().apply {
            this.type = "text/javascript"
            this.content = template.script
        })

        val processor =
            lbs?.find { it.name == "Processor.js" }?.readText() ?: throw Error("Processor.js is not defined!")
        page.addScriptTag(FrameAddScriptTagOptions().apply {
            this.type = "text/javascript"
            this.content = processor
        })

        page.isJavaScriptEnabled = true
        page.evaluate("document.fonts.ready")
        page.evaluate("window.processHandlebar()")

        val pdfOptions = PDFOptions()
        pdfOptions.landscape = template.landscape
        pdfOptions.margin = PDFMargin().apply {
            this.top = template.margin.top
            this.bottom = template.margin.bottom
            this.left = template.margin.left
            this.right = template.margin.right
        }

        pdfOptions.outline = true
        pdfOptions.format = PaperFormats.valueOf(template.documentType.lowercase())
        pdfOptions.printBackground = true
        pdfOptions.preferCSSPageSize = true
        pdfOptions.scale = 1.0
        val pdf = page.pdf(pdfOptions)

        cdpBrowser.close()

        return pdf
    }

    override fun uploadLibs(files: List<MultipartFile>) {
        logger.info("Syncing Libs")

        val folder = File(libs)
        if (!folder.exists()) {
            if (!folder.mkdir()) {
                throw Error("Path $libs doesn't exists and couldn't created")
            }
        }

        files.forEach { file ->
            logger.info("Syncing: ${file.originalFilename}")
            val template = Path(libs, file.originalFilename!!).toFile()

            if (template.exists())
                template.delete()

            val bts = file.bytes
            template.writeBytes(bts)
        }
        logger.info("Syncing Libs Completed")
    }

    private fun <T> String?.jsonToObject(valueType: Class<T>?): T {
        return this.let {
            val mapper = ObjectMapper().registerModule(KotlinModule())
                .registerModule(JavaTimeModule())
            mapper.readValue(this, valueType)
        }
    }

    private fun <T> T?.objectToJson(): String? {
        return this?.let {
            val mapper = ObjectMapper().registerModule(KotlinModule())
                .registerModule(JavaTimeModule())
                .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false)
            return mapper.writeValueAsString(this)
        }
    }

}