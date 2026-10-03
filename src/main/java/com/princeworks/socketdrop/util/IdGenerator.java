package com.princeworks.socketdrop.util;

import java.security.SecureRandom;
import java.util.UUID;

public final class IdGenerator {
  private IdGenerator() {}

  // Short room codes: 6 chars, unambiguous (no 0/O/1/I/L), ~1B combos.
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final char[] ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789".toCharArray();
  private static final int ROOM_CODE_LENGTH = 6;

  public static String generateRandomId() {
    UUID uuid = UUID.randomUUID();
    return uuid.toString();
  }

  public static String generateFileId() {
    return "file_" + generateRandomId();
  }

  public static String generateRoomId() {
    char[] buf = new char[ROOM_CODE_LENGTH];
    for (int i = 0; i < buf.length; i++) {
      buf[i] = ROOM_ALPHABET[RANDOM.nextInt(ROOM_ALPHABET.length)];
    }
    return new String(buf);
  }

  public static String generateUsername() {
    return "username_" + generateRandomId();
  }

  public static String normalizeRoomId(String rawRoomId) {
    if (rawRoomId == null) {
      return null;
    }
    String trimmed = rawRoomId.trim();
    if (trimmed.length() <= 8 && trimmed.matches("(?i)^[a-z0-9]{4,8}$")) {
      return trimmed.toUpperCase();
    }
    return trimmed;
  }
}
