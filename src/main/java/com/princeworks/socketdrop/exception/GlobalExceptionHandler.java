package com.princeworks.socketdrop.exception;

import com.princeworks.socketdrop.util.TimeUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(FileStorageException.class)
  public ResponseEntity<Map<String, Object>> fileStorageException(FileStorageException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", e.getMessage());
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  @ExceptionHandler(ResourceNotFoundException.class)
  public ResponseEntity<Map<String, Object>> resourceNotFoundException(
      ResourceNotFoundException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", e.getMessage());
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.NOT_FOUND);
  }

  @ExceptionHandler(InvalidArgumentException.class)
  public ResponseEntity<Map<String, Object>> invalidArgumentException(InvalidArgumentException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", e.getMessage());
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
  }

  @ExceptionHandler(ForbiddenOperationException.class)
  public ResponseEntity<Map<String, Object>> forbiddenOperationException(
      ForbiddenOperationException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", e.getMessage());
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.FORBIDDEN);
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  public ResponseEntity<Map<String, Object>> handleMaxUploadSizeExceededException(
      MaxUploadSizeExceededException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", "File size exceeds the maximum allowed upload limit");
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
  }

  @ExceptionHandler(MissingServletRequestParameterException.class)
  public ResponseEntity<Map<String, Object>> handleMissingParams(
      MissingServletRequestParameterException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", String.format("Required parameter '%s' is missing", e.getParameterName()));
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
  }

  /**
   * Unknown paths (404) must not be reported as 500. The catch-all below would otherwise turn every
   * missing static resource into an "unexpected error", which hides real outages from monitoring.
   */
  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<Map<String, Object>> handleNoResourceFoundException(
      NoResourceFoundException e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", "Resource not found");
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.NOT_FOUND);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> handleGenericException(Exception e) {
    Map<String, Object> error = new HashMap<>();
    error.put("message", "An unexpected error occurred");
    error.put("timestamp", TimeUtils.now());

    return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

