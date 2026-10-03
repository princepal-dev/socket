package com.princeworks.socketdrop.exception;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

class GlobalExceptionHandlerTest {

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

  @Test
  void handlesMaxUploadSizeExceeded() {
    MaxUploadSizeExceededException ex = new MaxUploadSizeExceededException(52428800L);
    ResponseEntity<Map<String, Object>> response = handler.handleMaxUploadSizeExceededException(ex);

    assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    assertNotNull(response.getBody());
    assertTrue(response.getBody().containsKey("message"));
  }

  @Test
  void handlesMissingServletRequestParameter() {
    MissingServletRequestParameterException ex =
        new MissingServletRequestParameterException("file", "MultipartFile");
    ResponseEntity<Map<String, Object>> response = handler.handleMissingParams(ex);

    assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    assertTrue(((String) response.getBody().get("message")).contains("file"));
  }

  @Test
  void handlesGenericExceptionWithoutLeakingInternals() {
    Exception ex = new RuntimeException("Database secret connection string");
    ResponseEntity<Map<String, Object>> response = handler.handleGenericException(ex);

    assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
    assertEquals("An unexpected error occurred", response.getBody().get("message"));
  }
}
