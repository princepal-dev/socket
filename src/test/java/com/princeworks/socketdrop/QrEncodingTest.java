package com.princeworks.socketdrop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/**
 * Guards the client-side QR encoder.
 *
 * <p>The encoder previously emitted Reed-Solomon parity that no decoder accepted, so every QR
 * failed to scan on a phone while still rendering a plausible-looking image. That failure was
 * invisible to the Java suite because the encoder lives in JavaScript.
 *
 * <p>{@code src/test/js/verify-qr.js} re-derives the error-correction parity with an independent
 * GF(256) implementation and asserts the format information, timing patterns, quiet zone and
 * mask/data-region agreement. This test just runs it, and skips when Node is unavailable.
 */
class QrEncodingTest {

  private static final long TIMEOUT_SECONDS = 60;

  @Test
  void qrEncoderProducesDecodableSymbols() throws Exception {
    Path script = Paths.get("src", "test", "js", "verify-qr.js").toAbsolutePath();
    assumeTrue(Files.exists(script), "QR verification script is missing: " + script);

    String node = findNode();
    assumeTrue(node != null, "Node.js is not available; skipping client-side QR validation");

    ProcessBuilder builder = new ProcessBuilder(node, script.toString());
    builder.redirectErrorStream(true);
    Process process = builder.start();

    List<String> output = new ArrayList<>();
    try (BufferedReader reader =
        new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        output.add(line);
      }
    }

    assertTrue(process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS), "QR validation timed out");
    String report = String.join("\n", output);
    assertEquals(0, process.exitValue(), "QR validation failed:\n" + report);
    assertTrue(report.contains("PASS"), "QR validation produced no PASS marker:\n" + report);
  }

  private static void assertTrue(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError(message);
    }
  }

  private static String findNode() {
    String configured = System.getenv("NODE_BINARY");
    if (configured != null && !configured.isBlank()) {
      return configured.trim();
    }
    return isExecutable("node") ? "node" : isExecutable("nodejs") ? "nodejs" : null;
  }

  private static boolean isExecutable(String candidate) {
    try {
      Process process = new ProcessBuilder(candidate, "--version").start();
      process.getInputStream().close();
      process.getErrorStream().close();
      return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
    } catch (Exception e) {
      return false;
    }
  }
}