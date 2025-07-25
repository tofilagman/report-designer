package org.r3al.report_server.components

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ControllerAdvice
import org.springframework.web.bind.annotation.ExceptionHandler


@ControllerAdvice
class ExceptionControllerAdvice {
    // default handler, in case the exception is not catch by any other catch method
    @ExceptionHandler(Exception::class)
    fun handleGenericException(ex: Exception): ResponseEntity<String?> {
        return ResponseEntity<String?>(ex.message, HttpStatus.INTERNAL_SERVER_ERROR)
    }
}