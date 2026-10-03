package com.princeworks.socketdrop.response.file;

import com.princeworks.socketdrop.helper.Type;

public class UploadProgressResponse {
  private final Type type = Type.UPLOAD_PROGRESS;
  private final String roomId;
  private final String status;
  private final String fileId;
  private final String fileName;
  private final Long fileSize;
  private final String message;
  private final String uploaderId;

  public UploadProgressResponse(
      String roomId,
      String status,
      String fileId,
      String fileName,
      Long fileSize,
      String message) {
    this(roomId, status, fileId, fileName, fileSize, message, null);
  }

  public UploadProgressResponse(
      String roomId,
      String status,
      String fileId,
      String fileName,
      Long fileSize,
      String message,
      String uploaderId) {
    this.roomId = roomId;
    this.status = status;
    this.fileId = fileId;
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.message = message;
    this.uploaderId = uploaderId;
  }

  public Type getType() {
    return type;
  }

  public String getRoomId() {
    return roomId;
  }

  public String getStatus() {
    return status;
  }

  public String getFileId() {
    return fileId;
  }

  public String getFileName() {
    return fileName;
  }

  public Long getFileSize() {
    return fileSize;
  }

  public String getMessage() {
    return message;
  }

  public String getUploaderId() {
    return uploaderId;
  }
}

