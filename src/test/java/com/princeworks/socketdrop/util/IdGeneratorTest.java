package com.princeworks.socketdrop.util;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class IdGeneratorTest {

  private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  @Test
  void roomIdIsSixCharsFromSafeAlphabet() {
    for (int i = 0; i < 500; i++) {
      String roomId = IdGenerator.generateRoomId();
      assertEquals(6, roomId.length(), "room code must be 6 chars: " + roomId);
      for (char c : roomId.toCharArray()) {
        assertTrue(ALPHABET.indexOf(c) >= 0, "illegal char '" + c + "' in " + roomId);
      }
    }
  }

  @Test
  void roomIdExcludesVisuallyAmbiguousCharacters() {
    String forbidden = "01OIL";
    for (int i = 0; i < 500; i++) {
      String roomId = IdGenerator.generateRoomId();
      for (char c : forbidden.toCharArray()) {
        assertFalse(roomId.indexOf(c) >= 0, "ambiguous char '" + c + "' in " + roomId);
      }
    }
  }

  @Test
  void roomIdsAreEffectivelyUnique() {
    // 32^6 ≈ 1.07e9 codes, so 5000 draws have an expected collision count of ~0.012
    // (birthday bound). Allow a handful of collisions but never a broken generator.
    int draws = 5000;
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < draws; i++) {
      seen.add(IdGenerator.generateRoomId());
    }
    int collisions = draws - seen.size();
    assertTrue(collisions <= 5, "too many collisions: " + collisions + " in " + draws + " draws");
    assertTrue(seen.size() >= draws - 5, "generator looks degenerate");
  }

  @Test
  void fileAndUserIdsKeepLegacyPrefixes() {
    assertTrue(IdGenerator.generateFileId().startsWith("file_"));
    assertTrue(IdGenerator.generateUsername().startsWith("username_"));
    assertEquals(36, IdGenerator.generateRandomId().length());
  }

  @Test
  void normalizeRoomIdNormalizesShortCodesAndPreservesLegacy() {
    assertNull(IdGenerator.normalizeRoomId(null));
    assertEquals("ABCDEF", IdGenerator.normalizeRoomId("abcdef"));
    assertEquals("ABCDEF", IdGenerator.normalizeRoomId("  abcdef  "));
    assertEquals("123456", IdGenerator.normalizeRoomId("123456"));
    assertEquals("room_legacy_12345", IdGenerator.normalizeRoomId("room_legacy_12345"));
  }
}