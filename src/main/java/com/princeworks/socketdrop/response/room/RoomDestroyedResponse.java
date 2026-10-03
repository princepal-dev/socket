package com.princeworks.socketdrop.response.room;

import com.princeworks.socketdrop.helper.Type;

public class RoomDestroyedResponse {
    private final Type type = Type.ROOM_DESTROYED;
    private final String roomId;
    private final int deletedFiles;
    private final String message;

    public RoomDestroyedResponse(String roomId, int deletedFiles, String message) {
        this.roomId = roomId;
        this.deletedFiles = deletedFiles;
        this.message = message;
    }

    public String getRoomId() {
        return roomId;
    }

    public int getDeletedFiles() {
        return deletedFiles;
    }

    public String getMessage() {
        return message;
    }

    public Type getType() {
        return type;
    }
}