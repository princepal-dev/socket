/**
 * Landing page — theme toggle only.
 * The transfer app lives on /app and loads app.js.
 */
(() => {
"use strict";

const THEME_KEY = "socketdrop-theme";

function preferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch (_) {}
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
}

const toggle = document.getElementById("themeToggle");
if (toggle) {
  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

applyTheme(preferredTheme());

try {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId") || params.get("room");
  if (roomId) {
    window.location.replace(`/app?roomId=${encodeURIComponent(roomId.trim())}`);
  }
} catch (_) {}
})();