package com.princeworks.socketdrop.response.room;

import com.princeworks.socketdrop.helper.Type;
import java.util.List;

public class RoomPresenceResponse {
    private final Type type = Type.ROOM_PRESENCE;
    private final String roomId;
    private final List<String> displayNames;
    private final int participantCount;

    public RoomPresenceResponse(String roomId, List<String> displayNames) {
        this.roomId = roomId;
        this.displayNames = displayNames == null ? List.of() : List.copyOf(displayNames);
        this.participantCount = this.displayNames.size();
    }

    public String getRoomId() {
        return roomId;
    }

    public List<String> getDisplayNames() {
        return displayNames;
    }

    public int getParticipantCount() {
        return participantCount;
    }

    public Type getType() {
        return type;
    }
}