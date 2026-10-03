package com.princeworks.socketdrop.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Clean URLs for the static pages. */
@Controller
public class PageController {

  /** Serves the transfer app at /app instead of exposing the .html extension. */
  @GetMapping({"/app", "/app/"})
  public String app() {
    return "forward:/app.html";
  }
}