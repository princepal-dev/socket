package com.princeworks.socketdrop.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Exposes server network identity (LAN IP and origin).
 *
 * <p>When clients access SocketDrop via {@code localhost}, mobile devices on the same Wi-Fi
 * cannot connect to {@code localhost}. This controller provides the host's actual local
 * network IPv4 address so client QR codes and invite links work seamlessly on phones.
 */
@RestController
public class NetworkInfoController {

  @GetMapping("/api/network-info")
  public ResponseEntity<Map<String, Object>> getNetworkInfo(HttpServletRequest request) {
    int port = request.getServerPort();
    String scheme = request.getScheme();
    String lanIp = detectLanIp();

    Map<String, Object> response = new LinkedHashMap<>();
    response.put("lanIp", lanIp);
    response.put("port", port);

    if (lanIp != null && !lanIp.isBlank()) {
      boolean isDefaultPort = (port == 80 && "http".equalsIgnoreCase(scheme))
          || (port == 443 && "https".equalsIgnoreCase(scheme));
      String portSuffix = isDefaultPort ? "" : ":" + port;
      response.put("lanUrl", scheme + "://" + lanIp + portSuffix);
    } else {
      response.put("lanUrl", null);
    }

    return ResponseEntity.ok(response);
  }

  /**
   * Discovers the primary non-loopback IPv4 address for local network access.
   */
  public static String detectLanIp() {
    try {
      Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
      if (interfaces == null) {
        return null;
      }

      String candidate = null;
      for (NetworkInterface iface : Collections.list(interfaces)) {
        if (iface.isLoopback() || !iface.isUp() || iface.isVirtual()) {
          continue;
        }

        for (InetAddress addr : Collections.list(iface.getInetAddresses())) {
          if (addr instanceof Inet4Address && !addr.isLoopbackAddress() && !addr.isLinkLocalAddress()) {
            String ip = addr.getHostAddress();
            // Prefer common private network ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
            if (ip.startsWith("192.168.") || ip.startsWith("10.")) {
              return ip;
            }
            if (candidate == null) {
              candidate = ip;
            }
          }
        }
      }
      return candidate;
    } catch (Exception ignored) {
      return null;
    }
  }
}
