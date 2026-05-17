import { ADMIN_PASSWORD, APP_BASE_URL, VENUE_CHECKIN_CODE } from "./firebase-config.js";
import {
  ensureAuth,
  getAllMembers,
  saveMember,
  deleteMember,
  getAttendanceForDate,
  getMemberAttendanceHistory,
  computeMemberSummary,
  updateAttendanceRecord,
  loadPenaltyRules,
  savePenaltyRules,
  getAllAttendanceRecords,
  computeTeamCollectibleReport,
  isFirebaseConfigured,
} from "./firebase-app.js";
import {
  formatDateKey,
  formatDisplayDate,
  formatTime,
  formatDateTime,
  getAttendanceDateTime,
  penaltyLabel,
  calculatePenalty,
  toDatetimeLocalManila,
  parseDatetimeLocalManila,
  getActivePenaltyRules,
  formatRulesSummaryHtml,
  timeStringToInputValue,
  inputValueToTimeString,
  timeStringToSeconds,
  attendancePenaltyBadgeHtml,
} from "./penalty.js";
import { attendanceToCSV, downloadCSV, summaryFromRows, collectibleReportToCSV, paymentsReportToCSV } from "./export.js";
import { drawQRToCanvas } from "./qrcode-lib.js";

const SESSION_KEY = "hrcc_admin_unlocked";

const passwordGate = document.getElementById("password-gate");
const adminApp = document.getElementById("admin-app");
const passwordForm = document.getElementById("password-form");
const passwordInput = document.getElementById("password-input");
const passwordError = document.getElementById("password-error");

const memberForm = document.getElementById("member-form");
const memberDocId = document.getElementById("member-doc-id");
const memberName = document.getElementById("member-name");
const memberRole = document.getElementById("member-role");
const memberSection = document.getElementById("member-section");
const memberIdInput = document.getElementById("member-id");
const memberFormTitle = document.getElementById("member-form-title");
const btnGenId = document.getElementById("btn-gen-id");
const btnCancelEdit = document.getElementById("btn-cancel-edit");
const memberList = document.getElementById("member-list");
const membersEmpty = document.getElementById("members-empty");
const membersLoading = document.getElementById("members-loading");

const filterDate = document.getElementById("filter-date");
const filterMember = document.getElementById("filter-member");
const attendanceList = document.getElementById("attendance-list");
const attendanceEmpty = document.getElementById("attendance-empty");
const attendanceStats = document.getElementById("attendance-stats");
const btnExport = document.getElementById("btn-export");

const penaltyDate = document.getElementById("penalty-date");
const penaltyStats = document.getElementById("penalty-stats");
const penaltyList = document.getElementById("penalty-list");
const penaltyEmpty = document.getElementById("penalty-empty");

const checkinQrWrap = document.getElementById("checkin-qr-wrap");
const checkinQrUrlEl = document.getElementById("checkin-qr-url");
const checkinQrLocalHint = document.getElementById("checkin-qr-local-hint");
const btnCopyCheckinUrl = document.getElementById("btn-copy-checkin-url");
const btnDownloadCheckinQr = document.getElementById("btn-download-checkin-qr");

const HISTORY_PAGE_SIZE = 5;

let membersCache = [];
let checkinQrCanvas = null;
let attendanceCache = [];
let memberHistoryRecords = [];
let memberHistoryPage = 1;
let memberHistoryMember = null;
let penaltyCache = [];
let editingAttendanceId = null;

const historyMemberSelect = document.getElementById("history-member-select");
const memberHistoryList = document.getElementById("member-history-list");
const memberHistoryEmpty = document.getElementById("member-history-empty");
const memberHistoryLoading = document.getElementById("member-history-loading");
const memberHistorySummary = document.getElementById("member-history-summary");
const memberHistoryPagination = document.getElementById("member-history-pagination");
const historyPrev = document.getElementById("history-prev");
const historyNext = document.getElementById("history-next");
const historyPageInfo = document.getElementById("history-page-info");

const editAttOverlay = document.getElementById("edit-att-overlay");
const editAttForm = document.getElementById("edit-att-form");
const editAttTitle = document.getElementById("edit-att-title");
const editAttMeta = document.getElementById("edit-att-meta");
const editAttTime = document.getElementById("edit-att-time");
const editAttPenalty = document.getElementById("edit-att-penalty");
const editAttError = document.getElementById("edit-att-error");
const btnRecalcPenalty = document.getElementById("btn-recalc-penalty");
const btnCloseEditAtt = document.getElementById("btn-close-edit-att");

const rulesForm = document.getElementById("rules-form");
const ruleOnTimeEnd = document.getElementById("rule-ontime-end");
const ruleLateEnd = document.getElementById("rule-late-end");
const rulePenaltyOnTime = document.getElementById("rule-penalty-ontime");
const rulePenaltyLate = document.getElementById("rule-penalty-late");
const rulePenaltyVeryLate = document.getElementById("rule-penalty-verylate");
const rulesPreview = document.getElementById("rules-preview");
const rulesError = document.getElementById("rules-error");
const rulesSaved = document.getElementById("rules-saved");
const editPenaltyPresets = document.getElementById("edit-penalty-presets");
const editAttPaid = document.getElementById("edit-att-paid");

const reportsLoading = document.getElementById("reports-loading");
const reportsSummary = document.getElementById("reports-summary");
const reportsMemberList = document.getElementById("reports-member-list");
const reportsEmpty = document.getElementById("reports-empty");
const reportsPaymentsAll = document.getElementById("reports-payments-all");
const reportsPaymentsEmpty = document.getElementById("reports-payments-empty");
const btnExportCollectible = document.getElementById("btn-export-collectible");
const btnExportPayments = document.getElementById("btn-export-payments");

let collectibleReportCache = null;

function todayInputValue() {
  return formatDateKey(new Date());
}

function unlockAdmin() {
  sessionStorage.setItem(SESSION_KEY, "1");
  passwordGate.classList.add("hidden");
  adminApp.classList.remove("hidden");
  initAdmin();
}

function checkSession() {
  if (sessionStorage.getItem(SESSION_KEY) === "1") {
    passwordGate.classList.add("hidden");
    adminApp.classList.remove("hidden");
    initAdmin();
  }
}

passwordForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const password = passwordInput?.value ?? "";
  if (password === ADMIN_PASSWORD) {
    passwordError.classList.add("hidden");
    unlockAdmin();
  } else {
    passwordError.classList.remove("hidden");
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "checkin-qr") renderCheckinQr();
    if (tab.dataset.tab === "attendance") loadAttendance();
    if (tab.dataset.tab === "penalties") loadPenalties();
    if (tab.dataset.tab === "rules") fillRulesForm();
    if (tab.dataset.tab === "reports") loadReports();
  });
});

function fillRulesForm() {
  const r = getActivePenaltyRules();
  if (ruleOnTimeEnd) ruleOnTimeEnd.value = timeStringToInputValue(r.onTimeEnd);
  if (ruleLateEnd) ruleLateEnd.value = timeStringToInputValue(r.lateEnd);
  if (rulePenaltyOnTime) rulePenaltyOnTime.value = String(r.penaltyOnTime);
  if (rulePenaltyLate) rulePenaltyLate.value = String(r.penaltyLate);
  if (rulePenaltyVeryLate) rulePenaltyVeryLate.value = String(r.penaltyVeryLate);
  refreshRulesPreview();
  syncEditPenaltyPresets();
}

function getRulesDraftFromForm() {
  return {
    onTimeEnd: inputValueToTimeString(ruleOnTimeEnd?.value || "08:30"),
    lateEnd: inputValueToTimeString(ruleLateEnd?.value || "08:35"),
    penaltyOnTime: rulePenaltyOnTime?.value ?? 0,
    penaltyLate: rulePenaltyLate?.value ?? 20,
    penaltyVeryLate: rulePenaltyVeryLate?.value ?? 30,
  };
}

function refreshRulesPreview() {
  if (!rulesPreview) return;
  rulesPreview.innerHTML = `<p style="margin:0 0 0.5rem;color:var(--text)">Preview (Manila time)</p><ul>${formatRulesSummaryHtml(getRulesDraftFromForm())}</ul>`;
}

function syncEditPenaltyPresets() {
  if (!editPenaltyPresets) return;
  const r = getActivePenaltyRules();
  editPenaltyPresets.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" data-penalty-preset="${r.penaltyOnTime}">₱${r.penaltyOnTime} On time</button>
    <button type="button" class="btn btn-ghost btn-sm" data-penalty-preset="${r.penaltyLate}">₱${r.penaltyLate} Late</button>
    <button type="button" class="btn btn-ghost btn-sm" data-penalty-preset="${r.penaltyVeryLate}">₱${r.penaltyVeryLate} Very late</button>
  `;
}

rulesForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  rulesError?.classList.add("hidden");
  rulesSaved?.classList.add("hidden");

  const onSec = timeStringToSeconds(inputValueToTimeString(ruleOnTimeEnd?.value));
  const lateSec = timeStringToSeconds(inputValueToTimeString(ruleLateEnd?.value));
  if (lateSec <= onSec) {
    if (rulesError) {
      rulesError.textContent = "“Late until” must be after “On time until”.";
      rulesError.classList.remove("hidden");
    }
    return;
  }

  const payload = {
    onTimeEnd: inputValueToTimeString(ruleOnTimeEnd?.value),
    lateEnd: inputValueToTimeString(ruleLateEnd?.value),
    penaltyOnTime: rulePenaltyOnTime?.value,
    penaltyLate: rulePenaltyLate?.value,
    penaltyVeryLate: rulePenaltyVeryLate?.value,
  };

  const btn = rulesForm.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    await savePenaltyRules(payload);
    fillRulesForm();
    if (rulesSaved) {
      rulesSaved.textContent = "Rules saved. New check-ins will use these settings.";
      rulesSaved.classList.remove("hidden");
    }
  } catch (err) {
    if (rulesError) {
      rulesError.textContent = err.message || "Could not save rules.";
      rulesError.classList.remove("hidden");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
});

[ruleOnTimeEnd, ruleLateEnd, rulePenaltyOnTime, rulePenaltyLate, rulePenaltyVeryLate].forEach((el) => {
  el?.addEventListener("input", refreshRulesPreview);
});

function getScannerPageUrl() {
  if (APP_BASE_URL && APP_BASE_URL.trim()) {
    return `${APP_BASE_URL.trim().replace(/\/$/, "")}/scanner.html`;
  }
  const base = window.location.href.replace(/[^/]*$/, "");
  return `${base}scanner.html`;
}

async function renderCheckinQr() {
  if (!checkinQrWrap) return;

  const code = VENUE_CHECKIN_CODE;
  const appUrl = getScannerPageUrl();
  if (checkinQrUrlEl) {
    checkinQrUrlEl.innerHTML = `QR code: <strong>${escapeHtml(code)}</strong><br>App link: ${escapeHtml(appUrl)}`;
  }

  if (checkinQrLocalHint) {
    checkinQrLocalHint.textContent =
      "Members open the scanner app, sign in with name + ID, then scan this QR at the door.";
    checkinQrLocalHint.classList.remove("hidden");
  }

  checkinQrWrap.innerHTML = "";
  checkinQrCanvas = document.createElement("canvas");
  checkinQrWrap.appendChild(checkinQrCanvas);

  try {
    await drawQRToCanvas(checkinQrCanvas, code);
  } catch (err) {
    console.error(err);
    checkinQrWrap.innerHTML = `<p class="empty-state">Could not generate QR: ${escapeHtml(err.message)}. Check your internet connection and refresh.</p>`;
  }
}

btnCopyCheckinUrl?.addEventListener("click", async () => {
  const text = `${VENUE_CHECKIN_CODE}\n${getScannerPageUrl()}`;
  try {
    await navigator.clipboard.writeText(text);
    btnCopyCheckinUrl.textContent = "Copied!";
    setTimeout(() => {
      btnCopyCheckinUrl.textContent = "Copy code & link";
    }, 2000);
  } catch {
    prompt("Copy:", text);
  }
});

btnDownloadCheckinQr?.addEventListener("click", () => {
  if (!checkinQrCanvas) return;
  const link = document.createElement("a");
  link.download = "hrcc-checkin-qr.png";
  link.href = checkinQrCanvas.toDataURL("image/png");
  link.click();
});

function generateMemberId() {
  const n = membersCache.length + 1;
  return `HRCC-${String(n).padStart(3, "0")}`;
}

btnGenId.addEventListener("click", () => {
  memberIdInput.value = generateMemberId();
});

function resetMemberForm() {
  memberForm.reset();
  memberDocId.value = "";
  memberFormTitle.textContent = "Add member";
  btnCancelEdit.classList.add("hidden");
  memberIdInput.readOnly = false;
}

btnCancelEdit.addEventListener("click", resetMemberForm);

memberForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isFirebaseConfigured()) {
    alert("Configure Firebase first.");
    return;
  }
  try {
    await ensureAuth();
    const data = {
      name: memberName.value,
      role: memberRole.value,
      section: memberSection.value,
      memberID: memberIdInput.value,
    };
    await saveMember(data, memberDocId.value || null);
    resetMemberForm();
    await loadMembers();
  } catch (err) {
    alert(err.message || "Failed to save member.");
  }
});

function formatPaymentWhen(paidAt) {
  if (!paidAt || Number.isNaN(paidAt.getTime())) return "Date not recorded";
  return formatDateTime(paidAt);
}

function paymentHistoryHtml(events) {
  if (!events?.length) {
    return '<p class="report-payments-none">No payments recorded.</p>';
  }
  return `<ul class="report-payments-member">${events
    .map((p) => {
      const when = formatPaymentWhen(p.paidAt);
      const label = p.type === "sunday" ? escapeHtml(p.description) : "Lump-sum payment";
      return `<li><span class="report-pay-amt">₱${p.amount}</span> · ${label} · <span class="report-pay-when">Paid ${escapeHtml(when)}</span></li>`;
    })
    .join("")}</ul>`;
}

async function loadReports() {
  if (!reportsSummary) return;
  reportsLoading?.classList.remove("hidden");
  reportsSummary.classList.add("hidden");
  reportsMemberList && (reportsMemberList.innerHTML = "");
  reportsPaymentsAll && (reportsPaymentsAll.innerHTML = "");
  reportsEmpty?.classList.add("hidden");
  reportsPaymentsEmpty?.classList.add("hidden");

  try {
    await ensureAuth();
    await loadPenaltyRules();
    const allRecords = await getAllAttendanceRecords();
    collectibleReportCache = computeTeamCollectibleReport(membersCache, allRecords);
    const r = collectibleReportCache;

    reportsSummary.innerHTML = `
      <div class="stat-box"><div class="value">₱${r.totalPenalties}</div><div class="label">Total penalties</div></div>
      <div class="stat-box stat-paid-total"><div class="value">₱${r.totalPaid}</div><div class="label">Total paid</div></div>
      <div class="stat-box stat-collectible"><div class="value">₱${r.totalCollectible}</div><div class="label">Total collectible</div></div>
      <div class="stat-box"><div class="value">${r.memberRows.filter((x) => x.summary.remainingBalance > 0).length}</div><div class="label">Members with balance</div></div>
    `;
    reportsSummary.classList.remove("hidden");

    if (!r.memberRows.length) {
      reportsEmpty?.classList.remove("hidden");
      return;
    }

    const allPay = r.allPayments || [];
    if (reportsPaymentsAll) {
      if (!allPay.length) {
        reportsPaymentsEmpty?.classList.remove("hidden");
      } else {
        for (const p of allPay) {
          const li = document.createElement("li");
          const when = formatPaymentWhen(p.paidAt);
          const label = p.type === "sunday" ? p.description : "Lump-sum payment";
          li.innerHTML = `<strong>${escapeHtml(p.member.name)}</strong> · <span class="report-pay-amt">₱${p.amount}</span> · ${escapeHtml(label)} · <span class="report-pay-when">Paid ${escapeHtml(when)}</span>`;
          reportsPaymentsAll.appendChild(li);
        }
      }
    }

    for (const { member, summary: s, paymentHistory } of r.memberRows) {
      const li = document.createElement("li");
      li.className = "attendance-item reports-member-row";
      const balClass = s.remainingBalance > 0 ? "reports-balance-due" : "reports-balance-clear";
      li.innerHTML = `
        <div class="attendance-meta">
          <strong>${escapeHtml(member.name)}</strong>
          <span>${escapeHtml(member.memberID)} · ${escapeHtml(member.role || "")}</span>
          <span class="${balClass}">Collectible: ₱${s.remainingBalance} · Paid: ₱${s.totalPaid} · Late (paid): ${s.latePaid}</span>
          ${paymentHistoryHtml(paymentHistory)}
        </div>
        <div class="attendance-item-actions">
          <span class="badge ${s.remainingBalance > 0 ? "badge-warning" : "badge-success"}">₱${s.remainingBalance}</span>
        </div>
      `;
      reportsMemberList.appendChild(li);
    }
  } catch (err) {
    if (reportsEmpty) {
      reportsEmpty.textContent = err.message || "Could not load report.";
      reportsEmpty.classList.remove("hidden");
    }
  } finally {
    reportsLoading?.classList.add("hidden");
  }
}

btnExportCollectible?.addEventListener("click", () => {
  if (!collectibleReportCache) {
    alert("Open the Reports tab first to load data.");
    return;
  }
  const csv = collectibleReportToCSV(collectibleReportCache);
  downloadCSV(csv, `hrcc-collectible-${todayInputValue()}.csv`);
});

btnExportPayments?.addEventListener("click", () => {
  if (!collectibleReportCache) {
    alert("Open the Reports tab first to load data.");
    return;
  }
  const csv = paymentsReportToCSV(collectibleReportCache);
  downloadCSV(csv, `hrcc-payments-${todayInputValue()}.csv`);
});

function editAttendanceButtonHtml(recordId) {
  return `<button type="button" class="btn btn-secondary btn-sm" data-edit-attendance="${escapeHtml(recordId)}">Edit</button>`;
}

function findAttendanceRecord(id) {
  return (
    memberHistoryRecords.find((r) => r.id === id) ||
    attendanceCache.find((r) => r.id === id) ||
    penaltyCache.find((r) => r.id === id) ||
    null
  );
}

function patchAttendanceInCaches(updated) {
  const patch = (arr) => {
    const i = arr.findIndex((r) => r.id === updated.id);
    if (i >= 0) arr[i] = { ...arr[i], ...updated };
  };
  patch(memberHistoryRecords);
  patch(attendanceCache);
  patch(penaltyCache);
}

async function refreshAfterAttendanceEdit(updated) {
  patchAttendanceInCaches(updated);
  const historyId = memberHistoryMember?.memberID || historyMemberSelect?.value;
  if (historyId && updated.memberID === historyId) {
    await loadMemberHistory(historyId);
  } else if (memberHistoryMember) {
    renderMemberHistorySummary(memberHistoryMember);
    renderMemberHistoryPage();
  }
  if (isFirebaseConfigured()) {
    await loadAttendance();
    if (document.getElementById("panel-penalties")?.classList.contains("active")) {
      await loadPenalties();
    }
    if (document.getElementById("panel-reports")?.classList.contains("active")) {
      await loadReports();
    }
  }
}

function updateEditPenaltyPreview() {
  const el = document.getElementById("edit-att-penalty-preview");
  if (!el || !editAttPenalty) return;
  const n = Math.max(0, Math.round(Number(editAttPenalty.value) || 0));
  el.textContent = n === 0 ? "Preview: On time (₱0)" : `Preview: ${penaltyLabel(n)} — balance uses ₱${n}`;
}

function openAttendanceEditModal(record) {
  if (!record?.id || !editAttOverlay) return;
  editingAttendanceId = record.id;
  const t = getAttendanceDateTime(record);
  editAttTitle.textContent = record.name || "Edit check-in";
  editAttMeta.textContent = `${record.memberID || ""} · ${formatDisplayDate(record.date)} · ${formatDateTime(t)}`;
  editAttTime.value = toDatetimeLocalManila(t);
  editAttPenalty.value = String(record.penalty ?? 0);
  if (editAttPaid) {
    editAttPaid.checked = !!record.penaltyPaid;
    editAttPaid.disabled = (record.penalty ?? 0) <= 0;
  }
  syncEditPenaltyPresets();
  updateEditPenaltyPreview();
  editAttError?.classList.add("hidden");
  editAttOverlay.classList.add("show");
  editAttOverlay.setAttribute("aria-hidden", "false");
}

function closeAttendanceEditModal() {
  editAttOverlay?.classList.remove("show");
  editAttOverlay?.setAttribute("aria-hidden", "true");
  editingAttendanceId = null;
  editAttError?.classList.add("hidden");
}

editAttOverlay?.addEventListener("click", (e) => {
  if (e.target === editAttOverlay) closeAttendanceEditModal();
});

btnCloseEditAtt?.addEventListener("click", closeAttendanceEditModal);

editAttOverlay?.addEventListener("click", (e) => {
  const preset = e.target.closest("[data-penalty-preset]");
  if (!preset || !editAttPenalty) return;
  editAttPenalty.value = preset.dataset.penaltyPreset;
  updateEditPenaltyPreview();
});

editAttPenalty?.addEventListener("input", () => {
  const n = Math.max(0, Math.round(Number(editAttPenalty.value) || 0));
  if (editAttPaid) {
    editAttPaid.disabled = n <= 0;
    if (n <= 0) editAttPaid.checked = false;
  }
  updateEditPenaltyPreview();
});

btnRecalcPenalty?.addEventListener("click", () => {
  const when = parseDatetimeLocalManila(editAttTime?.value);
  if (Number.isNaN(when.getTime())) return;
  if (editAttPenalty) editAttPenalty.value = String(calculatePenalty(when));
  updateEditPenaltyPreview();
});

editAttForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingAttendanceId) return;
  const when = parseDatetimeLocalManila(editAttTime?.value);
  if (Number.isNaN(when.getTime())) {
    if (editAttError) {
      editAttError.textContent = "Enter a valid check-in date and time.";
      editAttError.classList.remove("hidden");
    }
    return;
  }
  const penalty = Math.max(0, Math.round(Number(editAttPenalty?.value) || 0));
  const penaltyPaid = penalty > 0 && !!editAttPaid?.checked;
  if (editAttError) editAttError.classList.add("hidden");
  const submitBtn = editAttForm.querySelector('[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await ensureAuth();
    const previous = findAttendanceRecord(editingAttendanceId);
    const updated = await updateAttendanceRecord(editingAttendanceId, {
      checkInDate: when,
      penalty,
      penaltyPaid,
    });
    closeAttendanceEditModal();
    await refreshAfterAttendanceEdit({ ...previous, ...updated });
  } catch (err) {
    if (editAttError) {
      editAttError.textContent = err.message || "Could not save.";
      editAttError.classList.remove("hidden");
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-edit-attendance]");
  if (!btn) return;
  const record = findAttendanceRecord(btn.dataset.editAttendance);
  if (record) openAttendanceEditModal(record);
});

function renderMembers() {
  memberList.innerHTML = "";
  if (!membersCache.length) {
    membersEmpty.classList.remove("hidden");
    return;
  }
  membersEmpty.classList.add("hidden");
  for (const m of membersCache) {
    const li = document.createElement("li");
    li.className = "member-item";
    li.innerHTML = `
      <div class="member-meta">
        <strong>${escapeHtml(m.name)}</strong>
        <span>${escapeHtml(m.role)} · ${escapeHtml(m.section)} · ${escapeHtml(m.memberID)}</span>
      </div>
      <div class="member-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-history="${m.memberID}">History</button>
        <button type="button" class="btn btn-ghost btn-sm" data-edit="${m.id}">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-del="${m.id}">Del</button>
      </div>
    `;
    memberList.appendChild(li);
  }

  memberList.querySelectorAll("[data-history]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectMemberHistory(btn.dataset.history);
      document.getElementById("member-history-card")?.scrollIntoView({ behavior: "smooth" });
    });
  });
  memberList.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = membersCache.find((x) => x.id === btn.dataset.edit);
      if (m) startEditMember(m);
    });
  });
  memberList.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const m = membersCache.find((x) => x.id === btn.dataset.del);
      if (!m) return;
      if (!confirm(`Delete ${m.name}?`)) return;
      await deleteMember(m.id);
      await loadMembers();
    });
  });
}

function selectMemberHistory(memberID) {
  if (historyMemberSelect) {
    historyMemberSelect.value = memberID;
    loadMemberHistory(memberID);
  }
}

function startEditMember(m) {
  memberDocId.value = m.id;
  memberName.value = m.name;
  memberRole.value = m.role;
  memberSection.value = m.section;
  memberIdInput.value = m.memberID;
  memberIdInput.readOnly = true;
  memberFormTitle.textContent = "Edit member";
  btnCancelEdit.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateMemberFilter() {
  const val = filterMember.value;
  const historyVal = historyMemberSelect?.value || "";
  filterMember.innerHTML = '<option value="">All members</option>';
  if (historyMemberSelect) {
    historyMemberSelect.innerHTML = '<option value="">Choose a member…</option>';
  }
  for (const m of membersCache) {
    const opt = document.createElement("option");
    opt.value = m.memberID;
    opt.textContent = `${m.name} (${m.memberID})`;
    filterMember.appendChild(opt);
    if (historyMemberSelect) {
      const hOpt = document.createElement("option");
      hOpt.value = m.memberID;
      hOpt.textContent = `${m.name} (${m.memberID})`;
      historyMemberSelect.appendChild(hOpt);
    }
  }
  filterMember.value = val;
  if (historyMemberSelect && historyVal) {
    historyMemberSelect.value = historyVal;
  }
}

function getHistoryTotalPages() {
  return Math.max(1, Math.ceil(memberHistoryRecords.length / HISTORY_PAGE_SIZE));
}

function renderMemberHistoryPage() {
  if (!memberHistoryList) return;

  memberHistoryList.innerHTML = "";
  const totalPages = getHistoryTotalPages();
  if (memberHistoryPage > totalPages) memberHistoryPage = totalPages;
  if (memberHistoryPage < 1) memberHistoryPage = 1;

  const start = (memberHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pageRows = memberHistoryRecords.slice(start, start + HISTORY_PAGE_SIZE);

  if (!memberHistoryRecords.length) {
    memberHistoryEmpty?.classList.remove("hidden");
    memberHistoryPagination?.classList.add("hidden");
    memberHistorySummary?.classList.add("hidden");
    return;
  }

  memberHistoryEmpty?.classList.add("hidden");
  memberHistoryPagination?.classList.remove("hidden");

  for (const r of pageRows) {
    const t = getAttendanceDateTime(r);
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
      <div class="history-item-main">
        <strong>${formatDisplayDate(r.date)}</strong>
        <span>${formatDateTime(t)} · ${escapeHtml(r.serviceType || "Sunday Service")}</span>
      </div>
      <div class="history-item-end">
        ${attendancePenaltyBadgeHtml(r)}
        <span class="history-penalty-amt">${(r.penalty || 0) > 0 && !r.penaltyPaid ? `₱${r.penalty} due` : (r.penalty || 0) > 0 ? "Paid" : "—"}</span>
        ${editAttendanceButtonHtml(r.id)}
      </div>
    `;
    memberHistoryList.appendChild(li);
  }

  if (historyPageInfo) {
    historyPageInfo.textContent = `Page ${memberHistoryPage} of ${totalPages} (${memberHistoryRecords.length} total)`;
  }
  if (historyPrev) historyPrev.disabled = memberHistoryPage <= 1;
  if (historyNext) historyNext.disabled = memberHistoryPage >= totalPages;
}

function renderMemberHistorySummary(member) {
  if (!memberHistorySummary || !member) return;
  const summary = computeMemberSummary(member, memberHistoryRecords);
  memberHistorySummary.classList.remove("hidden");
  memberHistorySummary.innerHTML = `
    <div class="stats-grid history-stats">
      <div class="stat-box stat-balance"><div class="value">₱${summary.remainingBalance}</div><div class="label">Collectible</div></div>
      <div class="stat-box"><div class="value">₱${summary.totalPenalties}</div><div class="label">Penalties</div></div>
      <div class="stat-box"><div class="value">₱${summary.totalPaid}</div><div class="label">Total paid</div></div>
      <div class="stat-box"><div class="value">${summary.lateTotal}</div><div class="label">Late</div></div>
      <div class="stat-box"><div class="value">${summary.latePaid}</div><div class="label">Late & paid</div></div>
    </div>
  `;
}

async function loadMemberHistory(memberID) {
  if (!memberID) {
    memberHistoryRecords = [];
    memberHistoryMember = null;
    memberHistoryPage = 1;
    memberHistoryList && (memberHistoryList.innerHTML = "");
    memberHistoryEmpty?.classList.add("hidden");
    memberHistoryPagination?.classList.add("hidden");
    memberHistorySummary?.classList.add("hidden");
    return;
  }

  const member = membersCache.find((m) => m.memberID === memberID);
  if (!member) return;

  memberHistoryMember = member;
  memberHistoryPage = 1;
  memberHistoryLoading?.classList.remove("hidden");
  memberHistoryEmpty?.classList.add("hidden");
  memberHistoryPagination?.classList.add("hidden");

  try {
    await ensureAuth();
    memberHistoryRecords = await getMemberAttendanceHistory(memberID);
    renderMemberHistorySummary(member);
    renderMemberHistoryPage();
  } catch (err) {
    memberHistoryRecords = [];
    if (memberHistoryEmpty) {
      memberHistoryEmpty.textContent = err.message || "Could not load history.";
      memberHistoryEmpty.classList.remove("hidden");
    }
    memberHistorySummary?.classList.add("hidden");
  } finally {
    memberHistoryLoading?.classList.add("hidden");
  }
}

historyMemberSelect?.addEventListener("change", () => {
  loadMemberHistory(historyMemberSelect.value);
});

historyPrev?.addEventListener("click", () => {
  if (memberHistoryPage > 1) {
    memberHistoryPage -= 1;
    renderMemberHistoryPage();
  }
});

historyNext?.addEventListener("click", () => {
  if (memberHistoryPage < getHistoryTotalPages()) {
    memberHistoryPage += 1;
    renderMemberHistoryPage();
  }
});

function renderStats(container, summary) {
  container.innerHTML = `
    <div class="stat-box"><div class="value">${summary.present}</div><div class="label">Present</div></div>
    <div class="stat-box"><div class="value">₱${summary.penalties}</div><div class="label">Penalties</div></div>
    <div class="stat-box"><div class="value">${summary.onTime}</div><div class="label">On time</div></div>
    <div class="stat-box"><div class="value">${summary.late + summary.veryLate}</div><div class="label">Late</div></div>
  `;
}

function renderAttendanceList(rows, listEl, emptyEl) {
  listEl.innerHTML = "";
  const filtered = filterMember.value
    ? rows.filter((r) => r.memberID === filterMember.value)
    : rows;
  if (!filtered.length) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  for (const r of filtered) {
    const t = getAttendanceDateTime(r);
    const li = document.createElement("li");
    li.className = "attendance-item";
    li.innerHTML = `
      <div class="attendance-meta">
        <strong>${escapeHtml(r.name)}</strong>
        <span>${formatDateTime(t)} · ${escapeHtml(r.role || "")} · ${escapeHtml(r.memberID)}</span>
      </div>
      <div class="attendance-item-actions">
        ${attendancePenaltyBadgeHtml(r)}
        ${editAttendanceButtonHtml(r.id)}
      </div>
    `;
    listEl.appendChild(li);
  }
}

async function loadAttendance() {
  const dateKey = filterDate.value || todayInputValue();
  attendanceList.innerHTML = "";
  attendanceEmpty.classList.add("hidden");
  try {
    await ensureAuth();
    attendanceCache = await getAttendanceForDate(dateKey);
    const summary = summaryFromRows(attendanceCache);
    renderStats(attendanceStats, summary);
    renderAttendanceList(attendanceCache, attendanceList, attendanceEmpty);
  } catch (err) {
    attendanceEmpty.textContent = err.message;
    attendanceEmpty.classList.remove("hidden");
  }
}

async function loadPenalties() {
  const dateKey = penaltyDate.value || todayInputValue();
  try {
    await ensureAuth();
    const rows = await getAttendanceForDate(dateKey);
    const withPenalty = rows.filter((r) => (r.penalty || 0) > 0);
    penaltyCache = withPenalty;
    const summary = summaryFromRows(rows);
    renderStats(penaltyStats, summary);
    penaltyList.innerHTML = "";
    if (!withPenalty.length) {
      penaltyEmpty.classList.remove("hidden");
      return;
    }
    penaltyEmpty.classList.add("hidden");
    for (const r of withPenalty) {
      const t = getAttendanceDateTime(r);
      const li = document.createElement("li");
      li.className = "attendance-item";
      li.innerHTML = `
        <div class="attendance-meta">
          <strong>${escapeHtml(r.name)}</strong>
          <span>${formatTime(t)} — ${penaltyLabel(r.penalty)} · ${formatDateTime(t)}</span>
        </div>
        <div class="attendance-item-actions">
          ${attendancePenaltyBadgeHtml(r)}
          ${editAttendanceButtonHtml(r.id)}
        </div>
      `;
      penaltyList.appendChild(li);
    }
  } catch (err) {
    penaltyEmpty.textContent = err.message;
    penaltyEmpty.classList.remove("hidden");
  }
}

filterDate.addEventListener("change", loadAttendance);
filterMember.addEventListener("change", () => {
  renderAttendanceList(attendanceCache, attendanceList, attendanceEmpty);
});
penaltyDate.addEventListener("change", loadPenalties);

btnExport.addEventListener("click", () => {
  const dateKey = filterDate.value || todayInputValue();
  const rows = filterMember.value
    ? attendanceCache.filter((r) => r.memberID === filterMember.value)
    : attendanceCache;
  if (!rows.length) {
    alert("No data to export.");
    return;
  }
  const csv = attendanceToCSV(rows);
  downloadCSV(csv, `hrcc-attendance-${dateKey}.csv`);
});

async function loadMembers() {
  membersLoading.classList.remove("hidden");
  try {
    await ensureAuth();
    membersCache = await getAllMembers();
    renderMembers();
    populateMemberFilter();
  } finally {
    membersLoading.classList.add("hidden");
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

async function initAdmin() {
  renderCheckinQr();

  if (!isFirebaseConfigured()) {
    document.getElementById("config-banner").classList.remove("hidden");
    return;
  }
  filterDate.value = todayInputValue();
  penaltyDate.value = todayInputValue();
  try {
    await loadPenaltyRules();
    fillRulesForm();
    await loadMembers();
    await loadAttendance();
  } catch (err) {
    console.error(err);
  }
}

checkSession();
