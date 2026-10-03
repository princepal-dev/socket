package com.princeworks.socketdrop.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class NetworkInfoControllerTest {

  @Autowired
  private MockMvc mockMvc;

  @Test
  @DisplayName("GET /api/network-info returns network metadata and port")
  void testGetNetworkInfo() throws Exception {
    mockMvc.perform(get("/api/network-info"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.port").isNumber())
        .andExpect(jsonPath("$.lanIp").hasJsonPath())
        .andExpect(jsonPath("$.lanUrl").hasJsonPath());
  }
}
