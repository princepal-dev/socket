/**
 * SocketDrop — senior-grade vanilla JS client.
 *
 * Goals: dead-simple UX, zero state desync.
 * - Single-flight WebSocket connect + message queue + auto-rejoin
 * - Pending room-action lock (no double create/join)
 * - Real XHR upload progress + abort + 50 MB guard
 * - Real QR via qr.js (window.QRCode), XSS-safe rendering, event delegation
 */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15000;
const ROOM_ACTION_TIMEOUT_MS = 9000;

/* ---------- element handles (null-safe) ---------- */
const els = {
  wsStatus: $("wsStatus"),
  userAvatar: $("userAvatar"),
  currentUser: $("currentUser"),
  roomPrompt: $("roomPrompt"),
  joinHint: $("joinHint"),
  banner: $("activeRoomBanner"),
  bannerRoomId: $("bannerRoomId"),
  bannerUserBadge: $("bannerUserBadge"),
  displayName: $("displayName"),
  roomId: $("roomId"),
  pasteRoomBtn: $("pasteRoomBtn"),
  createRoomBtn: $("createRoomBtn"),
  joinRoomBtn: $("joinRoomBtn"),
  leaveRoomBtn: $("leaveRoomBtn"),
  shareCard: $("shareCard"),
  shareLinkInput: $("shareLinkInput"),
  copyShareLinkBtn: $("copyShareLinkBtn"),
  qrModalBtn: $("qrModalBtn"),
  qrContainer: $("qrCodeContainer"),
  fileSection: $("fileActionsSection"),
  dropZone: $("dropZone"),
  fileInput: $("uploadFile"),
  previewBar: $("filePreviewBar"),
  previewExt: $("previewExt"),
  previewName: $("previewFileName"),
  previewSize: $("previewFileSize"),
  cancelSelectBtn: $("cancelSelectBtn"),
  uploadBtn: $("uploadBtn"),
  progressWrap: $("uploadProgressWrap"),
  progressStatus: $("progressStatusText"),
  progressPct: $("progressPercent"),
  progressBar: $("progressBar"),
  progressTrack: $("progressTrack"),
  abortBtn: $("abortUploadBtn"),
  filesSection: $("filesListSection"),
  fileCountBadge: $("fileCountBadge"),
  fileSearch: $("fileSearchInput"),
  filesEmpty: $("filesEmptyState"),
  fileList: $("fileItemsList"),
  qrModal: $("qrModal"),
  closeQrBtn: $("closeQrModalBtn"),
  modalQr: $("modalQrCode"),
  modalUrl: $("modalRoomUrl"),
  copyModalUrlBtn: $("copyModalUrlBtn"),
  toasts: $("toastContainer"),
  themeToggle: $("themeToggle"),
  bannerCopy: $("bannerCopyBtn"),
  bannerShare: $("bannerShareBtn"),
  bannerQr: $("bannerQrBtn"),
  bannerLeave: $("bannerLeaveBtn"),
  peerName: $("peerName"),
  regenPeerBtn: $("regenPeerBtn"),
  shareCodeBig: $("shareCodeBig"),
  copyCodeBtn: $("copyCodeBtn"),
  modalRoomCode: $("modalRoomCode"),
  lanHint: $("lanHint"),
  // compat (hidden)
  currentRoom: $("currentRoom"),
  metricUser: $("metricUser"),
  fileCount: $("fileCount"),
  fileIdInput: $("fileIdInput"),
};

const state = {
  connected: false,
  roomId: "",
  userId: "",
  displayName: "",
  files: new Map(),
  uploading: false,
  pendingAction: null, // 'create' | 'join' | null
  pendingTimer: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  rejoinIntent: null, // { roomId, displayName } preserved across drops
  explicitLeave: false,
  searchQuery: "",
};

let socket = null;
let connectPromise = null;
const sendQueue = [];
let currentXhr = null;

/* ---------- utils ---------- */
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const v = bytes / Math.pow(k, i);
  return (v >= 100 ? Math.round(v) : v.toFixed(1)) + " " + sizes[i];
}

function getInitials(name) {
  if (!name) return "SD";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function extOf(name) {
  const base = String(name || "").split("?")[0].split("#")[0];
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 4);
}

/* ---------- auto peer name (no prompt, computer-name-like) ----------
   Browser JS cannot read OS computer name (privacy sandbox).
   Closest easy UX: stable friendly device label, persisted per browser.
   Looks like "Crimson-Fox-42", survives reloads, zero typing. */
const PEER_KEY = "socketdrop-peer";
const PEER_ADJ = ["Swift","Bright","Crimson","Misty","Neon","Quiet","Bold","Amber","Cobalt","Sunny","Frost","Ember","Lunar","Solar","Turbo","Gentle","Rapid","Calm","Vivid","Nimble"];
const PEER_ANIMAL = ["Fox","Eagle","Otter","Wolf","Bear","Hawk","Lynx","Tiger","Falcon","Whale","Raven","Panda","Koala","Zebra","Jaguar","Bison","Cobra","Dove","Moose","Seal"];
function randomPeerName() {
  const a = PEER_ADJ[Math.floor(Math.random() * PEER_ADJ.length)];
  const b = PEER_ANIMAL[Math.floor(Math.random() * PEER_ANIMAL.length)];
  const n = Math.floor(10 + Math.random() * 89);
  return `${a}-${b}-${n}`;
}
function getPeerName() {
  try {
    let v = localStorage.getItem(PEER_KEY);
    if (v && v.trim()) return v.trim().slice(0, 32);
  } catch (_) {}
  const gen = randomPeerName();
  try { localStorage.setItem(PEER_KEY, gen); } catch (_) {}
  return gen;
}
function setPeerName(v) {
  const clean = String(v || "").trim().slice(0, 32) || randomPeerName();
  try { localStorage.setItem(PEER_KEY, clean); } catch (_) {}
  state.displayName = clean;
  if (els.displayName) els.displayName.value = clean;
  renderState();
  return clean;
}

function showToast(message, type = "info") {
  if (!els.toasts) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const dot = document.createElement("span");
  dot.className = "toast-dot";
  dot.setAttribute("aria-hidden", "true");
  const txt = document.createElement("span");
  txt.textContent = String(message);
  toast.append(dot, txt);
  els.toasts.appendChild(toast);
  while (els.toasts.children.length > 4) els.toasts.firstChild.remove();
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

async function copyText(text, okMsg = "Copied!") {
  const value = String(text || "");
  if (!value) {
    showToast("Nothing to copy yet", "error");
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(okMsg, "success");
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast(okMsg, "success");
      return true;
    } catch (e2) {
      showToast("Copy failed — select it manually", "error");
      return false;
    }
  }
}

/* ---------- theme ---------- */
const THEME_KEY = "socketdrop-theme";
function getPreferredTheme() {
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === "dark" || s === "light") return s;
  } catch (_) {}
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}

/* ---------- connection ---------- */
function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/room`;
}

function setStatus(kind) {
  // kind: offline | connecting | online | reconnecting | uploading (overlay handled separately)
  if (!els.wsStatus) return;
  const label = els.wsStatus.querySelector(".status-label");
  els.wsStatus.classList.remove("connected", "disconnected", "connecting", "reconnecting");
  let text = "Offline";
  if (kind === "online") {
    els.wsStatus.classList.add("connected");
    text = state.roomId ? "In room" : "Online";
  } else if (kind === "connecting") {
    els.wsStatus.classList.add("connecting");
    text = "Connecting…";
  } else if (kind === "reconnecting") {
    els.wsStatus.classList.add("reconnecting");
    text = "Reconnecting…";
  } else {
    els.wsStatus.classList.add("disconnected");
    text = "Offline";
  }
  if (label) label.textContent = text;
}

function flushQueue() {
  while (sendQueue.length && socket && socket.readyState === WebSocket.OPEN) {
    const payload = sendQueue.shift();
    try {
      socket.send(JSON.stringify(payload));
    } catch (_) {
      sendQueue.unshift(payload);
      break;
    }
  }
}

function ensureConnected() {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;

  setStatus(state.reconnectAttempts > 0 ? "reconnecting" : "connecting");

  connectPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };
    try {
      socket = new WebSocket(wsUrl());
    } catch (e) {
      connectPromise = null;
      done(reject, e);
      return;
    }

    const openHandler = () => {
      state.connected = true;
      state.reconnectAttempts = 0;
      if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
      setStatus("online");
      flushQueue();
      // Auto-rejoin after an unexpected drop (new session => new userId via JOIN).
      if (state.rejoinIntent && !state.roomId) {
        const intent = state.rejoinIntent;
        state.rejoinIntent = null;
        queueRoomAction({ type: "JOIN_ROOM", roomId: intent.roomId, displayName: intent.displayName });
      } else if (state.rejoinIntent && state.roomId) {
        state.rejoinIntent = null;
      }
      connectPromise = null;
      done(resolve);
    };

    const failHandler = () => {
      state.connected = false;
      connectPromise = null;
      done(reject, new Error("Could not reach the server. Check your connection."));
    };

    socket.addEventListener("open", openHandler, { once: true });
    socket.addEventListener("error", failHandler, { once: true });

    socket.onclose = () => {
      state.connected = false;
      socket = null;
      connectPromise = null;
      // Preserve room intent for auto-rejoin unless user explicitly left.
      if (!state.explicitLeave && state.roomId) {
        state.rejoinIntent = { roomId: state.roomId, displayName: state.displayName };
        setStatus("reconnecting");
        scheduleReconnect();
      } else if (!state.explicitLeave) {
        setStatus("offline");
      }
      renderState();
    };

    socket.onerror = () => {
      // onclose follows; keep quiet to avoid double toast.
    };

    socket.onmessage = (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch (_) {
        // ignore non-JSON
      }
    };
  });

  return connectPromise;
}

function scheduleReconnect() {
  if (state.explicitLeave) return;
  if (state.reconnectTimer) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.6, state.reconnectAttempts));
  state.reconnectAttempts += 1;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (state.explicitLeave || state.connected) return;
    if (!state.rejoinIntent) return;
    try {
      await ensureConnected();
      renderState();
    } catch (_) {
      setStatus("reconnecting");
      scheduleReconnect();
      renderState();
    }
  }, delay);
}

function queueRoomAction(payload) {
  sendQueue.push(payload);
  flushQueue();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    ensureConnected().catch((e) => showToast(e.message, "error"));
  }
}

/* ---------- room actions ---------- */
function lockAction(kind) {
  state.pendingAction = kind;
  if (state.pendingTimer) clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(() => {
    if (state.pendingAction) {
      state.pendingAction = null;
      renderState();
      showToast("Server is taking too long — try again", "error");
    }
  }, ROOM_ACTION_TIMEOUT_MS);
  renderState();
}

function unlockAction() {
  state.pendingAction = null;
  if (state.pendingTimer) { clearTimeout(state.pendingTimer); state.pendingTimer = null; }
}

function currentDisplayName() {
  // No prompt: always use persisted auto peer name.
  if (state.displayName && state.displayName.trim()) return state.displayName;
  const peer = getPeerName();
  state.displayName = peer;
  if (els.displayName) els.displayName.value = peer;
  return peer;
}

async function onCreateRoom() {
  if (state.pendingAction || state.uploading && false) return;
  if (isInRoom()) {
    showToast("You are already in a room", "info");
    return;
  }
  const displayName = currentDisplayName();
  state.displayName = displayName;
  state.explicitLeave = false;
  lockAction("create");
  try {
    await ensureConnected();
    queueRoomAction({ type: "CREATE_ROOM", displayName });
  } catch (e) {
    unlockAction();
    renderState();
    showToast(e.message, "error");
  }
}

function normalizeRoomCode(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  // Short 4-8 char codes case-insensitive; legacy room_* exact.
  if (t.length <= 8 && /^[A-Za-z0-9]{4,8}$/.test(t)) return t.toUpperCase();
  return t;
}

async function onJoinRoom() {
  if (state.pendingAction) return;
  if (isInRoom()) {
    showToast("You are already in a room — leave first to join another", "info");
    return;
  }
  const roomId = normalizeRoomCode(els.roomId && els.roomId.value);
  if (els.roomId && roomId) els.roomId.value = roomId;
  if (!roomId) {
    showToast("Type the 6-letter code first, or create a new room", "error");
    if (els.roomId) els.roomId.focus();
    return;
  }
  const displayName = currentDisplayName();
  state.displayName = displayName;
  state.explicitLeave = false;
  lockAction("join");
  try {
    await ensureConnected();
    queueRoomAction({ type: "JOIN_ROOM", roomId, displayName });
  } catch (e) {
    unlockAction();
    renderState();
    showToast(e.message, "error");
  }
}

function onLeaveRoom() {
  if (!isInRoom() && !state.rejoinIntent) return;
  state.explicitLeave = true;
  state.rejoinIntent = null;
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  try {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "LEAVE_ROOM" }));
    }
  } catch (_) {}
  abortUpload(true);
  clearRoomState();
  showToast("Left the room");
}

function clearRoomState() {
  state.roomId = "";
  state.userId = "";
  state.files.clear();
  state.searchQuery = "";
  if (els.fileSearch) els.fileSearch.value = "";
  if (els.fileInput) els.fileInput.value = "";
  unlockAction();
  hidePreview();
  hideProgress();
  setStatus(state.connected ? "online" : "offline");
  renderState();
}

function isInRoom() {
  return Boolean(state.roomId && state.userId);
}

/* ---------- server messages ---------- */
function handleServerMessage(data) {
  if (!data || typeof data !== "object") return;
  switch (data.type) {
    case "ROOM_CREATED": {
      unlockAction();
      if (data.roomId) state.roomId = String(data.roomId);
      if (data.userId) state.userId = String(data.userId);
      if (data.displayName) {
        state.displayName = String(data.displayName);
        if (els.displayName) els.displayName.value = state.displayName;
      }
      state.explicitLeave = false;
      state.rejoinIntent = null;
      setStatus("online");
      renderState();
      showToast("Room created — share the link!", "success");
      break;
    }
    case "ROOM_JOINED": {
      unlockAction();
      if (data.roomId) state.roomId = String(data.roomId);
      if (data.userId) state.userId = String(data.userId);
      if (data.displayName) {
        state.displayName = String(data.displayName);
        if (els.displayName) els.displayName.value = state.displayName;
      }
      if (els.roomId && state.roomId) els.roomId.value = state.roomId;
      state.explicitLeave = false;
      state.rejoinIntent = null;
      setStatus("online");
      renderState();
      showToast("Joined room!", "success");
      break;
    }
    case "UPLOAD_PROGRESS": {
      if (data.status === "COMPLETED" && data.fileId) {
        const id = String(data.fileId);
        if (!state.files.has(id)) {
          state.files.set(id, {
            fileId: id,
            fileName: String(data.fileName || `${id}.bin`),
            fileSize: Number(data.fileSize || 0),
            uploadedAt: new Date(),
          });
          renderState();
        }
        if (!state.uploading) showToast(`New file: ${data.fileName || "file"}`, "success");
      } else if (data.status === "STARTED") {
        if (!state.uploading) showToast(`Someone is sending ${data.fileName || "a file"}…`, "info");
      } else if (data.status === "FAILED") {
        showToast(`Send failed: ${data.message || "unknown error"}`, "error");
      }
      break;
    }
    case "ERROR": {
      const msg = String((data && data.message) || "Something went wrong");
      // Auto-rejoin may target an expired room (last peer left => server evicted it).
      if (state.pendingAction && /does not exist/i.test(msg)) {
        unlockAction();
        state.rejoinIntent = null;
        if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
        renderState();
        showToast("That room has closed — create a new one", "error");
      } else if (state.pendingAction) {
        unlockAction();
        renderState();
        showToast(msg, "error");
      } else {
        showToast(msg, "error");
      }
      break;
    }
    default:
      break;
  }
}

/* ---------- rendering ---------- */
function shareUrl() {
  if (!state.roomId) return "";
  return `${window.location.origin}/?roomId=${encodeURIComponent(state.roomId)}`;
}

function renderQrInto(el, text, size) {
  if (!el) return;
  el.innerHTML = "";
  if (!text) {
    const ph = document.createElement("span");
    ph.className = "qr-placeholder";
    ph.textContent = "QR appears after you create a room";
    el.appendChild(ph);
    return;
  }
  try {
    if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
      el.innerHTML = window.QRCode.generateSvg(text, size);
      const svg = el.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "QR code for room link");
      }
      return;
    }
  } catch (_) {}
  const fallback = document.createElement("div");
  fallback.className = "qr-fallback";
  fallback.textContent = text;
  el.appendChild(fallback);
}

function renderState() {
  const inRoom = isInRoom();
  const busy = Boolean(state.pendingAction);

  if (els.currentUser) els.currentUser.textContent = state.displayName || "Guest";
  if (els.peerName) els.peerName.textContent = state.displayName || "…";
  if (els.userAvatar) els.userAvatar.textContent = getInitials(state.displayName || state.userId);
  if (els.currentRoom) els.currentRoom.textContent = state.roomId || "";
  if (els.metricUser) els.metricUser.textContent = state.userId || "Guest";
  if (els.fileCount) els.fileCount.textContent = String(state.files.size);
  if (els.fileCountBadge) els.fileCountBadge.textContent = String(state.files.size);
  if (els.fileIdInput && state.files.size === 1) {
    const [only] = state.files.keys();
    els.fileIdInput.value = only;
  }

  if (els.roomPrompt) {
    if (inRoom) els.roomPrompt.textContent = `You are in as ${state.displayName}. Share the link below.`;
    else if (busy) els.roomPrompt.textContent = state.pendingAction === "create" ? "Creating your room…" : "Joining room…";
    else if (state.rejoinIntent || (!state.connected && state.roomId)) els.roomPrompt.textContent = "Reconnecting… keep this tab open.";
    else els.roomPrompt.textContent = "Create a new room or join with a code. No name needed.";
  }
  if (els.joinHint) {
    if (inRoom) els.joinHint.textContent = "Room is live — invite others with the link or QR.";
    else els.joinHint.textContent = "You’ll get a link + QR to invite others.";
  }

  if (els.banner) els.banner.hidden = !inRoom;
  if (inRoom) {
    if (els.bannerRoomId) els.bannerRoomId.textContent = state.roomId;
    if (els.bannerUserBadge) els.bannerUserBadge.textContent = state.displayName || "Guest";
  }

  if (els.shareCard) els.shareCard.hidden = !inRoom;
  if (els.fileSection) els.fileSection.hidden = !inRoom;
  if (els.filesSection) els.filesSection.hidden = !inRoom;

  const url = shareUrl();
  if (els.shareLinkInput && inRoom) els.shareLinkInput.value = url;
  if (els.modalUrl && inRoom) els.modalUrl.value = url;
  if (els.shareCodeBig) els.shareCodeBig.textContent = inRoom ? state.roomId : "– – –";
  if (els.modalRoomCode) els.modalRoomCode.textContent = inRoom ? state.roomId : "– – –";
  if (els.lanHint) {
    const host = window.location.hostname || "";
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
    els.lanHint.hidden = !(inRoom && isLocal);
  }
  if (inRoom) {
    renderQrInto(els.qrContainer, url, 160);
    renderQrInto(els.modalQr, url, 232);
  }

  // Buttons: single source of truth, no desync.
  if (els.createRoomBtn) els.createRoomBtn.disabled = busy || inRoom;
  if (els.joinRoomBtn) els.joinRoomBtn.disabled = busy || inRoom;
  if (els.leaveRoomBtn) els.leaveRoomBtn.hidden = !inRoom;
  if (els.leaveRoomBtn) els.leaveRoomBtn.disabled = !inRoom;
  if (els.uploadBtn) {
    const hasFile = Boolean(els.fileInput && els.fileInput.files && els.fileInput.files[0]);
    els.uploadBtn.disabled = !inRoom || !hasFile || state.uploading;
  }

  // Steps indicator (2 steps now: room -> share)
  document.querySelectorAll(".step").forEach((el) => {
    const n = Number(el.getAttribute("data-step"));
    el.classList.toggle("done", inRoom);
    el.classList.toggle("active", !inRoom && n === 1);
  });

  renderFiles();
}

function renderFiles() {
  if (!els.fileList || !els.filesEmpty) return;
  const q = state.searchQuery.trim().toLowerCase();
  const items = [...state.files.values()]
    .filter((f) => !q || f.fileName.toLowerCase().includes(q) || f.fileId.toLowerCase().includes(q))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);

  els.fileList.innerHTML = "";
  const showEmpty = items.length === 0;
  els.filesEmpty.hidden = !showEmpty || state.files.size > 0 && items.length > 0 ? showEmpty : showEmpty;
  els.filesEmpty.hidden = items.length > 0 ? true : false;
  els.fileList.hidden = items.length === 0;

  if (items.length === 0 && state.files.size > 0) {
    els.filesEmpty.hidden = false;
    els.filesEmpty.querySelector(".empty-title").textContent = "No matches";
    els.filesEmpty.querySelector(".empty-desc").textContent = "Try a different search.";
    return;
  }
  if (state.files.size === 0) {
    els.filesEmpty.querySelector(".empty-title").textContent = "No files yet";
    els.filesEmpty.querySelector(".empty-desc").textContent = "Drop your first file above, or wait for a friend to send one.";
  }

  for (const file of items) {
    const card = document.createElement("div");
    card.className = "file-card-item";

    const main = document.createElement("div");
    main.className = "file-card-main";

    const pill = document.createElement("div");
    pill.className = "file-type-pill";
    pill.textContent = extOf(file.fileName);

    const meta = document.createElement("div");
    meta.className = "file-card-meta";
    const title = document.createElement("span");
    title.className = "file-card-title";
    title.textContent = file.fileName;
    title.title = file.fileName;
    const sub = document.createElement("div");
    sub.className = "file-card-sub";
    const size = document.createElement("span");
    size.textContent = formatBytes(file.fileSize);
    const dot = document.createElement("span");
    dot.textContent = "•";
    dot.setAttribute("aria-hidden", "true");
    const id = document.createElement("span");
    id.className = "file-id-chip";
    id.textContent = file.fileId.length > 18 ? file.fileId.slice(0, 18) + "…" : file.fileId;
    id.title = file.fileId;
    sub.append(size, dot, id);
    meta.append(title, sub);
    main.append(pill, meta);

    const actions = document.createElement("div");
    actions.className = "file-card-actions";

    const dl = document.createElement("button");
    dl.className = "btn btn-xs btn-lime";
    dl.type = "button";
    dl.dataset.action = "download";
    dl.dataset.id = file.fileId;
    dl.textContent = "Download";

    const del = document.createElement("button");
    del.className = "btn btn-xs btn-danger";
    del.type = "button";
    del.dataset.action = "delete";
    del.dataset.id = file.fileId;
    del.textContent = "Delete";

    actions.append(dl, del);
    card.append(main, actions);
    els.fileList.appendChild(card);
  }
}

/* ---------- file picking ---------- */
function hidePreview() {
  if (els.previewBar) els.previewBar.hidden = true;
}
function hideProgress() {
  if (els.progressWrap) els.progressWrap.hidden = true;
  if (els.progressBar) els.progressBar.style.width = "0%";
  if (els.progressPct) els.progressPct.textContent = "0%";
  if (els.progressTrack) els.progressTrack.setAttribute("aria-valuenow", "0");
}

function handleFileSelected() {
  const file = els.fileInput && els.fileInput.files && els.fileInput.files[0];
  if (!file) {
    hidePreview();
    renderState();
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    if (els.fileInput) els.fileInput.value = "";
    hidePreview();
    showToast("That file is over 50 MB — pick a smaller one", "error");
    renderState();
    return;
  }
  if (els.previewName) els.previewName.textContent = file.name;
  if (els.previewSize) els.previewSize.textContent = formatBytes(file.size);
  if (els.previewExt) els.previewExt.textContent = extOf(file.name);
  if (els.previewBar) els.previewBar.hidden = false;
  renderState();
}

/* ---------- upload (real progress) ---------- */
function setProgress(loaded, total, label) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  if (els.progressBar) els.progressBar.style.width = pct + "%";
  if (els.progressPct) els.progressPct.textContent = pct + "%";
  if (els.progressStatus) els.progressStatus.textContent = label || "Sending…";
  if (els.progressTrack) els.progressTrack.setAttribute("aria-valuenow", String(pct));
}

function uploadFile() {
  if (!isInRoom()) {
    showToast("Create or join a room first", "error");
    return;
  }
  if (state.uploading) return;
  const file = els.fileInput && els.fileInput.files && els.fileInput.files[0];
  if (!file) {
    showToast("Choose a file first", "error");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast("That file is over 50 MB", "error");
    return;
  }

  state.uploading = true;
  if (els.progressWrap) els.progressWrap.hidden = false;
  setProgress(0, 1, "Starting…");
  renderState();

  const xhr = new XMLHttpRequest();
  currentXhr = xhr;
  const url = `/file/uploads?roomId=${encodeURIComponent(state.roomId)}`;
  const form = new FormData();
  form.append("file", file, file.name);

  xhr.open("POST", url, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setProgress(e.loaded, e.total, `Sending ${formatBytes(e.loaded)} of ${formatBytes(e.total)}…`);
    else setProgress(0, 1, "Sending…");
  };

  xhr.onload = () => {
    currentXhr = null;
    state.uploading = false;
    let body = {};
    try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
    if (xhr.status >= 200 && xhr.status < 300 && body.fileId) {
      setProgress(1, 1, "Done!");
      const id = String(body.fileId);
      state.files.set(id, {
        fileId: id,
        fileName: String(body.fileName || file.name),
        fileSize: Number(body.fileSize || file.size),
        uploadedAt: new Date(),
      });
      if (els.fileIdInput) els.fileIdInput.value = id;
      if (els.fileInput) els.fileInput.value = "";
      hidePreview();
      renderState();
      showToast(`Sent ${file.name}`, "success");
      setTimeout(hideProgress, 1200);
    } else {
      hideProgress();
      renderState();
      showToast((body && body.message) || `Send failed (${xhr.status})`, "error");
    }
  };

  xhr.onerror = () => {
    currentXhr = null;
    state.uploading = false;
    hideProgress();
    renderState();
    showToast("Network error while sending", "error");
  };

  xhr.onabort = () => {
    currentXhr = null;
    state.uploading = false;
    hideProgress();
    renderState();
    showToast("Send cancelled", "info");
  };

  xhr.send(form);
}

function abortUpload(silent) {
  if (currentXhr && state.uploading) {
    try { currentXhr.abort(); } catch (_) {}
  } else if (!silent) {
    return;
  }
  currentXhr = null;
  state.uploading = false;
}

/* ---------- download / delete ---------- */
async function downloadFileById(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return;
  if (!isInRoom()) {
    showToast("Join a room first", "error");
    return;
  }
  try {
    showToast("Preparing download…", "info");
    const query = new URLSearchParams({ roomId: state.roomId, userId: state.userId });
    const res = await fetch(`/file/downloads/${encodeURIComponent(id)}?${query.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    let filename = `${id}.bin`;
    const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const std = disposition.match(/filename="?([^";]+)"?/i);
    if (utf8 && utf8[1]) {
      try { filename = decodeURIComponent(utf8[1]); } catch (_) { filename = utf8[1]; }
    } else if (std && std[1]) {
      filename = std[1];
    }
    const meta = state.files.get(id);
    if ((!filename || filename === `${id}.bin`) && meta) filename = meta.fileName;

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    showToast(`Saved ${filename}`, "success");
  } catch (e) {
    showToast(e.message || "Download failed", "error");
  }
}

async function deleteFileById(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return;
  const meta = state.files.get(id);
  const label = meta ? meta.fileName : id;
  if (!window.confirm(`Delete "${label}" for everyone in the room?`)) return;
  try {
    const query = new URLSearchParams();
    if (state.roomId) query.set("roomId", state.roomId);
    if (state.userId) query.set("userId", state.userId);
    const qs = query.toString() ? `?${query.toString()}` : "";
    const res = await fetch(`/file/downloads/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Delete failed (${res.status})`);
    }
    state.files.delete(id);
    renderState();
    showToast("File deleted", "success");
  } catch (e) {
    showToast(e.message || "Delete failed", "error");
  }
}

/* ---------- wiring ---------- */
function wire() {
  if (els.createRoomBtn) els.createRoomBtn.addEventListener("click", onCreateRoom);
  if (els.joinRoomBtn) els.joinRoomBtn.addEventListener("click", onJoinRoom);
  if (els.leaveRoomBtn) els.leaveRoomBtn.addEventListener("click", onLeaveRoom);
  if (els.bannerLeave) els.bannerLeave.addEventListener("click", onLeaveRoom);

  if (els.roomId) els.roomId.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onJoinRoom();
    }
  });
  if (els.regenPeerBtn) els.regenPeerBtn.addEventListener("click", () => {
    if (isInRoom()) {
      showToast("Leave the room to change your name", "info");
      return;
    }
    setPeerName(randomPeerName());
    showToast(`You are now ${state.displayName}`, "success");
  });

  if (els.pasteRoomBtn) els.pasteRoomBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showToast("Clipboard is empty", "info");
        return;
      }
      let candidate = text.trim();
      if (candidate.includes("roomId=")) {
        try {
          candidate = new URL(candidate).searchParams.get("roomId") || candidate;
        } catch (_) {}
      }
      candidate = normalizeRoomCode(candidate);
      if (els.roomId) els.roomId.value = candidate.trim();
      showToast("Code pasted — hit Join room", "success");
    } catch (_) {
      showToast("Clipboard blocked — paste manually", "error");
    }
  });

  const copyCode = () => copyText(state.roomId, "Room code copied — send the 6 letters!");
  const copyLink = () => copyText(shareUrl(), "Invite link copied!");
  if (els.bannerCopy) els.bannerCopy.addEventListener("click", copyCode);
  if (els.bannerShare) els.bannerShare.addEventListener("click", copyLink);
  if (els.copyShareLinkBtn) els.copyShareLinkBtn.addEventListener("click", copyLink);
  if (els.copyCodeBtn) els.copyCodeBtn.addEventListener("click", copyCode);
  if (els.roomId) els.roomId.addEventListener("input", () => {
    const pos = els.roomId.selectionStart;
    const up = els.roomId.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    // Only auto-format short codes, leave legacy room_* alone while typing.
    if (/^[A-Za-z0-9]{0,8}$/.test(els.roomId.value.trim()) && !els.roomId.value.includes("_")) {
      els.roomId.value = up;
      try { els.roomId.setSelectionRange(pos, pos); } catch (_) {}
    }
    renderState();
  });

  const openQr = () => {
    if (!isInRoom()) {
      showToast("Create or join a room first", "error");
      return;
    }
    if (els.qrModal) {
      els.qrModal.hidden = false;
      if (els.closeQrBtn) els.closeQrBtn.focus();
    }
  };
  if (els.qrModalBtn) els.qrModalBtn.addEventListener("click", openQr);
  if (els.bannerQr) els.bannerQr.addEventListener("click", openQr);
  const closeQr = () => { if (els.qrModal) els.qrModal.hidden = true; };
  if (els.closeQrBtn) els.closeQrBtn.addEventListener("click", closeQr);
  if (els.qrModal) els.qrModal.addEventListener("click", (e) => { if (e.target === els.qrModal) closeQr(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.qrModal && !els.qrModal.hidden) closeQr();
  });
  if (els.copyModalUrlBtn) els.copyModalUrlBtn.addEventListener("click", () => copyText(els.modalUrl && els.modalUrl.value, "Link copied!"));

  // Dropzone: click + keyboard + drag/drop (single-flight, no double-fire).
  if (els.dropZone) {
    els.dropZone.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (els.fileInput) els.fileInput.click();
    });
    els.dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (els.fileInput) els.fileInput.click();
      }
    });
    ["dragenter", "dragover"].forEach((ev) => els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((ev) => els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && e.relatedTarget && els.dropZone.contains(e.relatedTarget)) return;
      els.dropZone.classList.remove("dragover");
    }));
    els.dropZone.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length && els.fileInput) {
        try {
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          els.fileInput.files = dt.files;
        } catch (_) {
          // read-only in some browsers; fall back to input click
          showToast("Drop blocked — tap to choose instead", "error");
          return;
        }
        handleFileSelected();
      }
    });
  }
  if (els.fileInput) els.fileInput.addEventListener("change", handleFileSelected);
  if (els.cancelSelectBtn) els.cancelSelectBtn.addEventListener("click", () => {
    if (els.fileInput) els.fileInput.value = "";
    hidePreview();
    renderState();
  });
  if (els.uploadBtn) els.uploadBtn.addEventListener("click", uploadFile);
  if (els.abortBtn) els.abortBtn.addEventListener("click", () => abortUpload(false));

  // File list: single delegated listener (no per-card leaks, XSS-safe).
  if (els.fileList) els.fileList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "download") downloadFileById(id);
    else if (action === "delete") deleteFileById(id);
    else if (action === "copy-id") copyText(id, "File ID copied!");
  });

  if (els.fileSearch) els.fileSearch.addEventListener("input", () => {
    state.searchQuery = els.fileSearch.value || "";
    renderFiles();
  });

  if (els.themeToggle) els.themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  window.addEventListener("online", () => {
    if (state.rejoinIntent && !state.connected) {
      state.reconnectAttempts = 0;
      ensureConnected().catch(() => {});
    }
  });
}

function initFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("roomId") || params.get("room");
    const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    const initial = q || hash;
    if (initial && els.roomId) {
      els.roomId.value = initial;
      showToast("Room code filled in — hit Join room", "info");
    }
  } catch (_) {}
}

/* ---------- boot ---------- */
applyTheme(getPreferredTheme());
state.displayName = getPeerName();
if (els.displayName) els.displayName.value = state.displayName;
setStatus("offline");
wire();
initFromUrl();
renderState();

})();
