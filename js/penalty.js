/**
 * Sunday attendance penalty rules (Asia/Manila).
 * Defaults apply until admin saves custom rules in Firestore.
 */

const MANILA_TZ = "Asia/Manila";

export function getDefaultPenaltyRules() {
  return {
    onTimeEnd: "08:30:00",
    lateEnd: "08:35:00",
    penaltyOnTime: 0,
    penaltyLate: 20,
    penaltyVeryLate: 30,
  };
}

let activeRules = { ...getDefaultPenaltyRules() };

export function getActivePenaltyRules() {
  return { ...activeRules };
}

export function setActivePenaltyRules(rules) {
  activeRules = normalizePenaltyRules(rules);
}

/** Parse HH:mm or HH:mm:ss to seconds since midnight. */
export function timeStringToSeconds(value) {
  if (!value) return 0;
  const parts = String(value).trim().split(":").map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

/** For &lt;input type="time"&gt; (HH:mm). */
export function timeStringToInputValue(value) {
  const sec = timeStringToSeconds(value);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** From time input to stored HH:mm:ss. */
export function inputValueToTimeString(value) {
  if (!value) return "00:00:00";
  const parts = value.split(":").map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export function normalizePenaltyRules(raw) {
  const d = getDefaultPenaltyRules();
  const onTimeEnd = raw?.onTimeEnd ? inputValueToTimeString(timeStringToInputValue(raw.onTimeEnd)) : d.onTimeEnd;
  let lateEnd = raw?.lateEnd ? inputValueToTimeString(timeStringToInputValue(raw.lateEnd)) : d.lateEnd;
  if (timeStringToSeconds(lateEnd) <= timeStringToSeconds(onTimeEnd)) {
    lateEnd = d.lateEnd;
  }
  return {
    onTimeEnd,
    lateEnd,
    penaltyOnTime: Math.max(0, Math.round(Number(raw?.penaltyOnTime ?? d.penaltyOnTime))),
    penaltyLate: Math.max(0, Math.round(Number(raw?.penaltyLate ?? d.penaltyLate))),
    penaltyVeryLate: Math.max(0, Math.round(Number(raw?.penaltyVeryLate ?? d.penaltyVeryLate))),
  };
}

export function formatTimeAmPm(timeStr) {
  const sec = timeStringToSeconds(timeStr);
  const h24 = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** HTML list items for home / admin preview. */
export function formatRulesSummaryHtml(rules = activeRules) {
  const r = normalizePenaltyRules(rules);
  const onTime = formatTimeAmPm(r.onTimeEnd);
  const late = formatTimeAmPm(r.lateEnd);
  return `
    <li>On or before <strong style="color: var(--success)">${onTime}</strong> — ₱${r.penaltyOnTime}</li>
    <li><strong style="color: var(--warning)">After ${onTime} until ${late}</strong> — ₱${r.penaltyLate}</li>
    <li><strong style="color: var(--danger)">After ${late}</strong> — ₱${r.penaltyVeryLate}</li>
  `;
}

export function getAttendanceDateTime(record) {
  if (!record) return new Date();
  if (record.checkedInAt?.toDate) return record.checkedInAt.toDate();
  if (record.timeIn?.toDate) return record.timeIn.toDate();
  if (typeof record.timeInMs === "number" && !Number.isNaN(record.timeInMs)) {
    return new Date(record.timeInMs);
  }
  if (record.timeInISO) return new Date(record.timeInISO);
  if (record.timeIn) return new Date(record.timeIn);
  if (record.date) return new Date(`${record.date}T12:00:00`);
  return new Date();
}

export function getAttendanceTimeMs(record) {
  return getAttendanceDateTime(record).getTime();
}

function getManilaTimeParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MANILA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function getArrivalSeconds(date) {
  const { hour, minute, second } = getManilaTimeParts(date);
  return hour * 3600 + minute * 60 + second;
}

export function calculatePenalty(arrivalDate, rules = activeRules) {
  const r = normalizePenaltyRules(rules);
  const sec = getArrivalSeconds(arrivalDate);
  const graceEnd = timeStringToSeconds(r.onTimeEnd);
  const lateEnd = timeStringToSeconds(r.lateEnd);
  if (sec <= graceEnd) return r.penaltyOnTime;
  if (sec <= lateEnd) return r.penaltyLate;
  return r.penaltyVeryLate;
}

/** HTML badges: on time, late, or late + paid. */
export function attendancePenaltyBadgeHtml(record) {
  const n = Number(record?.penalty) || 0;
  const paid = !!record?.penaltyPaid;
  if (n === 0) return '<span class="badge badge-success">On time</span>';
  const late =
    n === 20
      ? '<span class="badge badge-warning">₱20 Late</span>'
      : n === 30
        ? '<span class="badge badge-danger">₱30 Late</span>'
        : `<span class="badge badge-warning">₱${n} Late</span>`;
  if (paid) return `${late}<span class="badge badge-paid">Paid</span>`;
  return late;
}

export function penaltyLabel(amount, rules = activeRules) {
  const r = normalizePenaltyRules(rules);
  const n = Number(amount) || 0;
  if (n === r.penaltyOnTime) return "On time";
  if (n === r.penaltyLate) return `Late (by ${formatTimeAmPm(r.lateEnd)})`;
  if (n === r.penaltyVeryLate) return `Very late (after ${formatTimeAmPm(r.lateEnd)})`;
  return `Custom penalty (₱${n})`;
}

export function formatTime(date) {
  const d = date instanceof Date ? date : getAttendanceDateTime({ timeIn: date });
  return d.toLocaleTimeString("en-PH", {
    timeZone: MANILA_TZ,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatDateTime(date) {
  const d = date instanceof Date ? date : getAttendanceDateTime({ timeIn: date });
  return d.toLocaleString("en-PH", {
    timeZone: MANILA_TZ,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function formatDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-CA", { timeZone: MANILA_TZ });
}

export function formatDisplayDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-PH", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function toDatetimeLocalManila(date) {
  const d = date instanceof Date ? date : getAttendanceDateTime({ timeIn: date });
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export function parseDatetimeLocalManila(value) {
  if (!value) return new Date(NaN);
  const [datePart, timePart = "00:00:00"] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const timeBits = timePart.split(":").map(Number);
  const hh = timeBits[0] ?? 0;
  const mm = timeBits[1] ?? 0;
  const ss = timeBits[2] ?? 0;
  return new Date(
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+08:00`
  );
}
