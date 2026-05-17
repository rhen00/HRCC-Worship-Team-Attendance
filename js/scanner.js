import { VENUE_CHECKIN_CODE } from "./firebase-config.js";
import {
  ensureAuth,
  recordAttendance,
  verifyMemberLogin,
  getMemberAttendanceHistory,
  computeMemberSummary,
  loadPenaltyRules,
  isFirebaseConfigured,
} from "./firebase-app.js";
import {
  formatTime,
  formatDateTime,
  penaltyLabel,
  formatDisplayDate,
  getAttendanceDateTime,
  attendancePenaltyBadgeHtml,
} from "./penalty.js";

const SESSION_KEY = "hrcc_scanner_member";

const viewLogin = document.getElementById("view-login");
const viewScan = document.getElementById("view-scan");
const viewHistory = document.getElementById("view-history");

const loginForm = document.getElementById("login-form");
const loginName = document.getElementById("login-name");
const loginId = document.getElementById("login-id");
const loginError = document.getElementById("login-error");
const scanMemberLabel = document.getElementById("scan-member-label");
const btnLogout = document.getElementById("btn-logout");
const btnToggle = document.getElementById("btn-toggle-scan");
const btnRequestCamera = document.getElementById("btn-request-camera");
const btnManualCheckin = document.getElementById("btn-manual-checkin");
const manualQrInput = document.getElementById("manual-qr-input");
const cameraPermissionPanel = document.getElementById("camera-permission-panel");
const cameraPermissionError = document.getElementById("camera-permission-error");
const cameraPermissionStatus = document.getElementById("camera-permission-status");
const insecureBanner = document.getElementById("insecure-banner");
const qrReaderEl = document.getElementById("qr-reader");
const btnScanAgain = document.getElementById("btn-scan-again");
const btnSignOut = document.getElementById("btn-sign-out");

const overlay = document.getElementById("feedback-overlay");
const feedbackCard = document.getElementById("feedback-card");
const feedbackIcon = document.getElementById("feedback-icon");
const feedbackTitle = document.getElementById("feedback-title");
const feedbackMessage = document.getElementById("feedback-message");
const feedbackPenalty = document.getElementById("feedback-penalty");
const btnDismiss = document.getElementById("feedback-dismiss");

let scanner = null;
let scanning = false;
let processing = false;
let lastScanned = "";
let currentMember = null;
let feedbackOnDismiss = null;

const SCAN_COOLDOWN_MS = 2500;

function saveSession(member) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(member));
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  currentMember = null;
}

function showView(name) {
  viewLogin.classList.toggle("hidden", name !== "login");
  viewScan.classList.toggle("hidden", name !== "scan");
  viewHistory.classList.toggle("hidden", name !== "history");
}

function showFeedback(type, title, message, penalty = null, onDismiss = null) {
  feedbackCard.className = `feedback-card ${type}`;
  const icons = { success: "✅", warning: "⚠️", error: "❌" };
  feedbackIcon.textContent = icons[type] || "ℹ️";
  feedbackTitle.textContent = title;
  feedbackMessage.textContent = message;
  if (penalty !== null && penalty !== undefined) {
    feedbackPenalty.textContent =
      penalty === 0 ? "No penalty — on time" : `Penalty: ₱${penalty} (${penaltyLabel(penalty)})`;
    feedbackPenalty.classList.remove("hidden");
  } else {
    feedbackPenalty.classList.add("hidden");
  }
  feedbackOnDismiss = onDismiss;
  overlay.classList.add("show");
}

function hideFeedback() {
  overlay.classList.remove("show");
  lastScanned = "";
  const cb = feedbackOnDismiss;
  feedbackOnDismiss = null;
  if (cb) cb();
}

function getConnectionInfo() {
  const { protocol, hostname } = window.location;
  if (protocol === "file:") {
    return {
      needsLocalhost: true,
      hint: "You opened a file directly. Double-click start-test.bat in the project folder.",
      testUrl: "http://localhost:8080/scanner.html",
    };
  }
  if (
    !window.isSecureContext &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    return {
      needsLocalhost: true,
      hint: `Address http://${hostname} cannot use the camera. On this PC, use localhost instead.`,
      testUrl: "http://localhost:8080/scanner.html",
    };
  }
  return { needsLocalhost: false, hint: "", testUrl: "" };
}

function updateInsecureBanner() {
  if (!insecureBanner) return;
  const info = getConnectionInfo();
  if (!info.needsLocalhost) {
    insecureBanner.classList.add("hidden");
    insecureBanner.innerHTML = "";
    return;
  }
  insecureBanner.classList.remove("hidden");
  insecureBanner.innerHTML = `
    <strong>Local test:</strong> ${escapeHtml(info.hint)}
    <a href="${escapeHtml(info.testUrl)}">${escapeHtml(info.testUrl)}</a>
    — or use <strong>Testing without camera</strong> below.
  `;
}

function isValidCheckInScan(text, member) {
  const t = text.trim();
  const upper = t.toUpperCase();
  if (upper === VENUE_CHECKIN_CODE.toUpperCase()) return true;
  if (upper === member.memberID.toUpperCase()) return true;
  try {
    const u = new URL(t);
    if (u.pathname.includes("scanner.html")) return true;
  } catch (_) {}
  return false;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

async function showMemberHistory(member, todayResult = null) {
  await ensureAuth();
  const records = await getMemberAttendanceHistory(member.memberID);
  const summary = computeMemberSummary(member, records);

  document.getElementById("history-name").textContent = member.name;
  document.getElementById("history-id").textContent = member.memberID;
  document.getElementById("history-subtitle").textContent = `${member.role} · ${member.section}`;

  document.getElementById("stat-balance").textContent = `₱${summary.remainingBalance}`;
  document.getElementById("stat-penalties").textContent = `₱${summary.totalPenalties}`;
  const statPaidEl = document.getElementById("stat-paid");
  if (statPaidEl) statPaidEl.textContent = `₱${summary.totalPaid}`;
  const statCheckins = document.getElementById("stat-checkins");
  if (statCheckins) statCheckins.textContent = String(summary.totalCheckIns ?? records.length);
  document.getElementById("stat-present").textContent = String(summary.totalPresent);
  document.getElementById("stat-ontime").textContent = String(summary.onTime);
  document.getElementById("stat-late").textContent = String(summary.lateTotal);

  const todayMsg = document.getElementById("today-checkin-msg");
  if (todayResult?.status === "success" && todayResult.record) {
    const t = getAttendanceDateTime(todayResult.record);
    const repeatNote = todayResult.isRepeatToday
      ? " (new log added — previous check-ins today kept in history)"
      : "";
    todayMsg.textContent = `✓ Checked in at ${formatDateTime(t)} — ${penaltyLabel(todayResult.record.penalty)}${repeatNote}`;
    todayMsg.classList.remove("hidden");
  } else {
    todayMsg.classList.add("hidden");
  }

  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  list.innerHTML = "";

  if (!records.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    for (const r of records) {
      const t = getAttendanceDateTime(r);
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <div class="history-item-main">
          <strong>${escapeHtml(formatDisplayDate(r.date))}</strong>
          <span>${escapeHtml(formatDateTime(t))} · ${escapeHtml(r.serviceType || "Sunday Service")}</span>
        </div>
        <div class="history-item-end">
          ${attendancePenaltyBadgeHtml(r)}
          <span class="history-penalty-amt">${(r.penalty || 0) > 0 && !r.penaltyPaid ? `₱${r.penalty} due` : (r.penalty || 0) > 0 ? "Paid" : "—"}</span>
        </div>
      `;
      list.appendChild(li);
    }
  }

  await stopScanner();
  showView("history");
}

async function handleScan(decodedText) {
  if (!currentMember || processing) return;
  const text = decodedText.trim();
  if (!text || text === lastScanned) return;

  processing = true;
  lastScanned = text;

  try {
    if (!isValidCheckInScan(text, currentMember)) {
      showFeedback(
        "error",
        "Wrong QR",
        "Scan the church check-in QR at the door, or your own member QR card."
      );
      return;
    }

    await ensureAuth();
    const result = await recordAttendance(currentMember);
    lastScanned = "";

    await showMemberHistory(currentMember, result);
  } catch (err) {
    console.error(err);
    showFeedback("error", "Error", err.message || "Could not save attendance.");
  } finally {
    processing = false;
    setTimeout(() => {
      if (!overlay.classList.contains("show")) lastScanned = "";
    }, SCAN_COOLDOWN_MS);
  }
}

function cameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera was blocked. Allow camera in browser settings, then tap Ask permission to open camera again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is in use by another app. Close other apps using the camera and try again.";
  }
  const info = getConnectionInfo();
  if (info.needsLocalhost) {
    return `${info.hint} Open ${info.testUrl} or use manual check-in below.`;
  }
  return err?.message || "Could not access the camera.";
}

async function getCameraPermissionState() {
  if (!navigator.permissions?.query) return null;
  try {
    const result = await navigator.permissions.query({ name: "camera" });
    return result.state;
  } catch {
    return null;
  }
}

function setPermissionStatus(message, isError = false) {
  if (!cameraPermissionStatus) return;
  if (!message) {
    cameraPermissionStatus.classList.add("hidden");
    cameraPermissionStatus.textContent = "";
    return;
  }
  cameraPermissionStatus.textContent = message;
  cameraPermissionStatus.classList.toggle("is-error", isError);
  cameraPermissionStatus.classList.remove("hidden");
}

/** Triggers the browser's native camera permission dialog. */
async function requestCameraPermission() {
  const info = getConnectionInfo();
  if (info.needsLocalhost && window.location.protocol === "file:") {
    throw new Error(`${info.hint} Open ${info.testUrl}`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Your browser does not support camera access. Try Chrome or Safari.");
  }

  setPermissionStatus("Waiting for permission… Choose Allow in the popup.");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    stream.getTracks().forEach((track) => track.stop());
    setPermissionStatus("Camera allowed. Starting scanner…");
  } catch (err) {
    setPermissionStatus("", false);
    if (!window.isSecureContext && info.needsLocalhost) {
      throw new Error(`${info.hint} Open ${info.testUrl}`);
    }
    throw err;
  }
}

function showCameraPermissionUi() {
  if (cameraPermissionPanel) cameraPermissionPanel.classList.remove("hidden");
  if (qrReaderEl) qrReaderEl.classList.add("qr-reader-hidden");
  if (btnToggle) btnToggle.classList.add("hidden");
  if (cameraPermissionError) cameraPermissionError.classList.add("hidden");
  if (btnRequestCamera) {
    btnRequestCamera.disabled = false;
    btnRequestCamera.textContent = "Ask permission to open camera";
  }
  setPermissionStatus("");
}

function showCameraActiveUi() {
  if (cameraPermissionPanel) cameraPermissionPanel.classList.add("hidden");
  if (qrReaderEl) qrReaderEl.classList.remove("qr-reader-hidden");
  if (btnToggle) btnToggle.classList.remove("hidden");
}

async function startScanner() {
  if (scanning || !currentMember) return;

  if (!window.Html5Qrcode) {
    showFeedback("error", "Scanner unavailable", "QR scanner library failed to load.");
    return;
  }

  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (_) {}
  }

  scanner = new Html5Qrcode("qr-reader");
  const config = { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 };

  try {
    if (btnRequestCamera) {
      btnRequestCamera.disabled = true;
      btnRequestCamera.textContent = "Starting camera…";
    }
    await scanner.start({ facingMode: "environment" }, config, (t) => handleScan(t), () => {});
    scanning = true;
    showCameraActiveUi();
    if (btnToggle) btnToggle.disabled = false;
  } catch (err) {
    console.error(err);
    showCameraPermissionUi();
    const msg = cameraErrorMessage(err);
    if (cameraPermissionError) {
      cameraPermissionError.textContent = msg;
      cameraPermissionError.classList.remove("hidden");
    } else {
      showFeedback("error", "Camera error", msg);
    }
  } finally {
    if (btnRequestCamera && !scanning) {
      btnRequestCamera.disabled = false;
      btnRequestCamera.textContent = "Ask permission to open camera";
    }
  }
}

async function allowCameraAndScan() {
  if (cameraPermissionError) cameraPermissionError.classList.add("hidden");

  const state = await getCameraPermissionState();
  if (state === "granted") {
    setPermissionStatus("Camera already allowed. Opening scanner…");
    await startScanner();
    return;
  }

  if (btnRequestCamera) {
    btnRequestCamera.disabled = true;
    btnRequestCamera.textContent = "Requesting permission…";
  }

  try {
    await requestCameraPermission();
    await startScanner();
    setPermissionStatus("");
  } catch (err) {
    console.error(err);
    const msg = cameraErrorMessage(err);
    if (cameraPermissionError) {
      cameraPermissionError.textContent = msg;
      cameraPermissionError.classList.remove("hidden");
    } else {
      showFeedback("error", "Camera permission", msg);
    }
    if (btnRequestCamera) {
      btnRequestCamera.disabled = false;
      btnRequestCamera.textContent = "Ask permission to open camera";
    }
  }
}

async function stopScanner() {
  if (scanner && scanning) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (_) {}
  }
  scanning = false;
  showCameraPermissionUi();
}

function openScanView(member) {
  currentMember = member;
  saveSession(member);
  scanMemberLabel.textContent = `${member.name} · ${member.memberID}`;
  if (manualQrInput && !manualQrInput.value) {
    manualQrInput.placeholder = VENUE_CHECKIN_CODE;
  }
  updateInsecureBanner();
  if (scanning) {
    void stopScanner();
  } else {
    showCameraPermissionUi();
  }
  showView("scan");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");

  if (!isFirebaseConfigured()) {
    loginError.textContent = "Firebase is not configured.";
    loginError.classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    await ensureAuth();
    await loadPenaltyRules();
    const result = await verifyMemberLogin(loginName.value, loginId.value);
    if (!result.ok) {
      loginError.textContent = result.error;
      loginError.classList.remove("hidden");
      return;
    }
    openScanView(result.member);
    btn.textContent = "Opening camera…";
    await allowCameraAndScan();
  } catch (err) {
    loginError.textContent = err.message || "Could not verify. Try again.";
    loginError.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue to scan";
  }
});

function signOut() {
  void stopScanner();
  clearSession();
  loginForm.reset();
  loginError.classList.add("hidden");
  showView("login");
  updateInsecureBanner();
}

btnLogout?.addEventListener("click", signOut);
btnSignOut?.addEventListener("click", signOut);

btnScanAgain?.addEventListener("click", async () => {
  if (!currentMember) return;
  openScanView(currentMember);
  await allowCameraAndScan();
});

btnRequestCamera?.addEventListener("click", () => allowCameraAndScan());

btnManualCheckin?.addEventListener("click", () => {
  const code = manualQrInput?.value?.trim() || VENUE_CHECKIN_CODE;
  if (code) handleScan(code);
});

manualQrInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnManualCheckin?.click();
  }
});

btnToggle?.addEventListener("click", () => {
  if (scanning) void stopScanner();
});

btnDismiss.addEventListener("click", hideFeedback);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) hideFeedback();
});

async function init() {
  updateInsecureBanner();
  if (isFirebaseConfigured()) {
    try {
      await loadPenaltyRules();
    } catch (_) {}
  }
  const saved = loadSession();
  if (saved?.memberID) {
    try {
      await ensureAuth();
      const result = await verifyMemberLogin(saved.name, saved.memberID);
      if (result.ok) {
        openScanView(result.member);
        return;
      }
    } catch (_) {}
    clearSession();
  }
  showView("login");
}

init();
