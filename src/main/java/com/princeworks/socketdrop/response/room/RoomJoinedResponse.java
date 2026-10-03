package com.princeworks.socketdrop.response.room;

import com.princeworks.socketdrop.helper.Type;

public class RoomJoinedResponse {
  private final Type type = Type.ROOM_JOINED;
  private final String roomId;
  private final String userId;
  private final String displayName;
  private final java.util.List<com.princeworks.socketdrop.model.file.FileMeta> files;

  public RoomJoinedResponse(String roomId, String userId, String displayName) {
    this(roomId, userId, displayName, java.util.List.of());
  }

  public RoomJoinedResponse(
      String roomId,
      String userId,
      String displayName,
      java.util.List<com.princeworks.socketdrop.model.file.FileMeta> files) {
    this.roomId = roomId;
    this.userId = userId;
    this.displayName = displayName;
    this.files = files == null ? java.util.List.of() : java.util.List.copyOf(files);
  }

  public java.util.List<com.princeworks.socketdrop.model.file.FileMeta> getFiles() {
    return files;
  }

  public Type getType() {
    return type;
  }

  public String getRoomId() {
    return roomId;
  }

  public String getUserId() {
    return userId;
  }

  public String getDisplayName() {
    return displayName;
  }
}

