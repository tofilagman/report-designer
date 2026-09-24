package org.r3al.report_server

import com.ruiyun.jvppeteer.cdp.core.Puppeteer
import com.ruiyun.jvppeteer.cdp.entities.FetcherOptions
import org.r3al.report_server.components.GlobalDataManager
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.runApplication
import org.springframework.context.event.EventListener

@SpringBootApplication
class ReportServerApplication {

	val logger = LoggerFactory.getLogger(ReportServerApplication::class.java)

	@Autowired
	lateinit var dataManager: GlobalDataManager

	@Value("\${browser.path}")
	lateinit var browserPath: String

	@EventListener(ApplicationReadyEvent::class)
	fun startup() {
		if(browserPath.isNotBlank()) {
			dataManager.executablePath = browserPath
			logger.info("Browser path: $browserPath")
		} else {
			logger.info("Initialize Browser")
			val options = FetcherOptions()
			options.cacheDir = "temp"
			val revisionInfo = Puppeteer.downloadBrowser(options)
			dataManager.executablePath = revisionInfo.executablePath
			logger.info("Browser ready: ${revisionInfo.revision}")
			logger.info("Browser path: ${revisionInfo.executablePath}")
		}
	}
}

fun main(args: Array<String>) {
	runApplication<ReportServerApplication>(*args)
}

