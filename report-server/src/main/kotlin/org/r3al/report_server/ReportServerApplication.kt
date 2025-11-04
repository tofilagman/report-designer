package org.r3al.report_server

import com.ruiyun.jvppeteer.api.core.Browser
import com.ruiyun.jvppeteer.api.core.Page
import com.ruiyun.jvppeteer.cdp.core.Puppeteer
import com.ruiyun.jvppeteer.cdp.entities.FetcherOptions
import com.ruiyun.jvppeteer.cdp.entities.GoToOptions
import com.ruiyun.jvppeteer.cdp.entities.LaunchOptions
import com.ruiyun.jvppeteer.cdp.entities.PDFOptions
import com.ruiyun.jvppeteer.cdp.entities.PaperFormats
import com.ruiyun.jvppeteer.common.PuppeteerLifeCycle
import org.r3al.report_server.components.GlobalDataManager
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.runApplication
import org.springframework.context.event.EventListener

@SpringBootApplication
class ReportServerApplication {

	val logger = LoggerFactory.getLogger(ReportServerApplication::class.java)

	@Autowired
	lateinit var dataManager: GlobalDataManager

	@EventListener(ApplicationReadyEvent::class)
	fun startup() {
		logger.info("Initialize Browser")
		val options = FetcherOptions()
		options.cacheDir = "temp"
		val revisionInfo = Puppeteer.downloadBrowser(options)
		dataManager.executablePath = revisionInfo.executablePath
		logger.info("Browser ready: ${revisionInfo.revision}")



	}
}

fun main(args: Array<String>) {
	runApplication<ReportServerApplication>(*args)
}

