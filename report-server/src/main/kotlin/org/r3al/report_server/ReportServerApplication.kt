package org.r3al.report_server

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class ReportServerApplication

fun main(args: Array<String>) {
	runApplication<ReportServerApplication>(*args)
}
