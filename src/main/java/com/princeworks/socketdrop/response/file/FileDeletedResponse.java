package com.princeworks.socketdrop.response.file;

import com.princeworks.socketdrop.helper.Type;

public class FileDeletedResponse {
  private final Type type = Type.FILE_DELETED;
  private final String roomId;
  private final String fileId;
  private final String fileName;

  public FileDeletedResponse(String roomId, String fileId, String fileName) {
    this.roomId = roomId;
    this.fileId = fileId;
    this.fileName = fileName;
  }

  public Type getType() {
    return type;
  }

  public String getRoomId() {
    return roomId;
  }

  public String getFileId() {
    return fileId;
  }

  public String getFileName() {
    return fileName;
  }
}
