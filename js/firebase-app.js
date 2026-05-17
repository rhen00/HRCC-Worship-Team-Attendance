import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  addDoc,
  serverTimestamp,
  Timestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  formatDateKey,
  formatDisplayDate,
  calculatePenalty,
  getAttendanceDateTime,
  getAttendanceTimeMs,
  normalizePenaltyRules,
  getDefaultPenaltyRules,
  setActivePenaltyRules,
} from "./penalty.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

let authReady = null;

function formatAuthError(err) {
  const code = err?.code || "";
  if (code === "auth/configuration-not-found") {
    return new Error(
      "Firebase Authentication is not set up yet. In Firebase Console open Authentication → Get started, then enable Anonymous under Sign-in method."
    );
  }
  if (code === "auth/operation-not-allowed") {
    return new Error(
      "Anonymous sign-in is disabled. Enable it: Authentication → Sign-in method → Anonymous → Enable."
    );
  }
  return err;
}

export function ensureAuth() {
  if (authReady) return authReady;
  authReady = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        unsub();
        resolve(user);
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch (err) {
        unsub();
        reject(formatAuthError(err));
      }
    });
  });
  return authReady;
}

const MEMBERS = "members";
const ATTENDANCE = "attendance";
const SETTINGS = "settings";
const PENALTY_RULES_ID = "penaltyRules";

let penaltyRulesReady = null;

/** Load penalty rules from Firestore (cached). */
export async function loadPenaltyRules() {
  if (penaltyRulesReady) return penaltyRulesReady;
  penaltyRulesReady = (async () => {
    try {
      await ensureAuth();
      const snap = await getDoc(doc(db, SETTINGS, PENALTY_RULES_ID));
      const rules = snap.exists()
        ? normalizePenaltyRules(snap.data())
        : getDefaultPenaltyRules();
      setActivePenaltyRules(rules);
      return rules;
    } catch {
      const rules = getDefaultPenaltyRules();
      setActivePenaltyRules(rules);
      return rules;
    }
  })();
  return penaltyRulesReady;
}

export async function savePenaltyRules(rules) {
  await ensureAuth();
  const normalized = normalizePenaltyRules(rules);
  await setDoc(
    doc(db, SETTINGS, PENALTY_RULES_ID),
    { ...normalized, updatedAt: serverTimestamp() },
    { merge: true }
  );
  setActivePenaltyRules(normalized);
  penaltyRulesReady = Promise.resolve(normalized);
  return normalized;
}

/** Normalize Firestore doc for UI (accurate check-in time). */
export function normalizeAttendanceRecord(id, data) {
  const checkedAt = getAttendanceDateTime(data);
  return {
    id,
    ...data,
    date: data.date || formatDateKey(checkedAt),
    timeInMs: data.timeInMs ?? checkedAt.getTime(),
    timeInISO: data.timeInISO || checkedAt.toISOString(),
    _checkedAt: checkedAt,
  };
}

function mapAttendanceDocs(snap) {
  return snap.docs.map((d) => normalizeAttendanceRecord(d.id, d.data()));
}

function sortByTimeDesc(rows) {
  return rows.sort((a, b) => getAttendanceTimeMs(b) - getAttendanceTimeMs(a));
}

function sortByTimeAsc(rows) {
  return rows.sort((a, b) => getAttendanceTimeMs(a) - getAttendanceTimeMs(b));
}

export async function getMemberByMemberId(memberID) {
  const q = query(collection(db, MEMBERS), where("memberID", "==", memberID.trim()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getAllMembers() {
  const snap = await getDocs(query(collection(db, MEMBERS), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function getPenaltyPaidAt(record) {
  if (!record?.penaltyPaid) return null;
  if (record.penaltyPaidAt?.toDate) return record.penaltyPaidAt.toDate();
  if (typeof record.penaltyPaidAtMs === "number" && !Number.isNaN(record.penaltyPaidAtMs)) {
    return new Date(record.penaltyPaidAtMs);
  }
  if (record.penaltyPaidAtISO) return new Date(record.penaltyPaidAtISO);
  if (record.updatedAt?.toDate) return record.updatedAt.toDate();
  return null;
}

export function getMemberLumpPaymentAt(member) {
  if (!(Number(member?.amountPaid) > 0)) return null;
  if (member.amountPaidUpdatedAt?.toDate) return member.amountPaidUpdatedAt.toDate();
  if (typeof member.amountPaidUpdatedAtMs === "number" && !Number.isNaN(member.amountPaidUpdatedAtMs)) {
    return new Date(member.amountPaidUpdatedAtMs);
  }
  if (member.updatedAt?.toDate) return member.updatedAt.toDate();
  return null;
}

/** Payment events for reports (newest first). */
export function buildMemberPaymentHistory(member, records) {
  const events = [];
  const forPenalty = getLatestCheckInPerDay(records);
  for (const r of forPenalty) {
    if (!r.penaltyPaid || !(r.penalty > 0)) continue;
    events.push({
      type: "sunday",
      amount: r.penalty,
      paidAt: getPenaltyPaidAt(r),
      sundayDate: r.date,
      description: `Sunday ${formatDisplayDate(r.date)}`,
    });
  }
  const lump = Number(member?.amountPaid) || 0;
  if (lump > 0) {
    events.push({
      type: "member",
      amount: lump,
      paidAt: getMemberLumpPaymentAt(member),
      description: "Member lump-sum payment",
    });
  }
  events.sort((a, b) => {
    const ta = a.paidAt?.getTime() ?? 0;
    const tb = b.paidAt?.getTime() ?? 0;
    return tb - ta;
  });
  return events;
}

export async function saveMember(data, docId = null) {
  const existing = await getMemberByMemberId(data.memberID);
  if (existing && existing.id !== docId) {
    throw new Error(`Member ID ${data.memberID} is already in use.`);
  }
  const amountPaid = Math.max(0, Number(data.amountPaid) || 0);
  const payload = {
    name: data.name.trim(),
    role: data.role.trim(),
    section: data.section.trim(),
    memberID: data.memberID.trim().toUpperCase(),
    amountPaid,
    updatedAt: serverTimestamp(),
  };
  if (docId) {
    const prevSnap = await getDoc(doc(db, MEMBERS, docId));
    const prevPaid = prevSnap.exists() ? Number(prevSnap.data().amountPaid) || 0 : 0;
    if (amountPaid !== prevPaid) {
      payload.amountPaidUpdatedAt = serverTimestamp();
      payload.amountPaidUpdatedAtMs = Date.now();
    }
    await setDoc(doc(db, MEMBERS, docId), payload, { merge: true });
    return docId;
  }
  if (amountPaid > 0) {
    payload.amountPaidUpdatedAt = serverTimestamp();
    payload.amountPaidUpdatedAtMs = Date.now();
  }
  payload.createdAt = serverTimestamp();
  const ref = await addDoc(collection(db, MEMBERS), payload);
  return ref.id;
}

export async function deleteMember(docId) {
  await deleteDoc(doc(db, MEMBERS, docId));
}

export async function getAttendanceForDate(dateKey) {
  const q = query(collection(db, ATTENDANCE), where("date", "==", dateKey));
  const snap = await getDocs(q);
  return sortByTimeAsc(mapAttendanceDocs(snap));
}

export async function verifyMemberLogin(name, memberID) {
  const member = await getMemberByMemberId(memberID);
  if (!member) {
    return { ok: false, error: "Member ID not found. Check your ID or contact admin." };
  }
  const inputName = name.trim().toLowerCase();
  const storedName = (member.name || "").trim().toLowerCase();
  if (inputName !== storedName) {
    return { ok: false, error: "Name does not match our records for this ID." };
  }
  return { ok: true, member };
}

export async function getMemberAttendanceHistory(memberID) {
  const id = memberID.trim().toUpperCase();
  const q = query(collection(db, ATTENDANCE), where("memberID", "==", id));
  const snap = await getDocs(q);
  return sortByTimeDesc(mapAttendanceDocs(snap));
}

/** One entry per calendar day (latest check-in) for penalty totals. */
export function getLatestCheckInPerDay(records) {
  const byDate = new Map();
  for (const r of records) {
    const key = r.date || formatDateKey(getAttendanceDateTime(r));
    const prev = byDate.get(key);
    if (!prev || getAttendanceTimeMs(r) > getAttendanceTimeMs(prev)) {
      byDate.set(key, r);
    }
  }
  return Array.from(byDate.values());
}

export function computeMemberSummary(member, records) {
  const forPenalty = getLatestCheckInPerDay(records);
  const totalPenalties = forPenalty.reduce((sum, r) => sum + (r.penalty || 0), 0);
  const amountPaid = Number(member.amountPaid) || 0;
  const paidOnRecords = forPenalty
    .filter((r) => r.penaltyPaid && (r.penalty || 0) > 0)
    .reduce((sum, r) => sum + (r.penalty || 0), 0);
  const onTime = forPenalty.filter((r) => (r.penalty || 0) === 0).length;
  const late20 = forPenalty.filter((r) => r.penalty === 20).length;
  const late30 = forPenalty.filter((r) => r.penalty === 30).length;
  const lateTotal = forPenalty.filter((r) => (r.penalty || 0) > 0).length;
  const latePaid = forPenalty.filter((r) => (r.penalty || 0) > 0 && r.penaltyPaid).length;
  const sundaysPresent = forPenalty.length;
  const totalPaid = amountPaid + paidOnRecords;
  return {
    totalPresent: sundaysPresent,
    totalCheckIns: records.length,
    onTime,
    late20,
    late30,
    lateTotal,
    latePaid,
    totalPenalties,
    amountPaid,
    paidOnRecords,
    totalPaid,
    remainingBalance: Math.max(0, totalPenalties - totalPaid),
  };
}

export async function getAllAttendanceRecords() {
  const snap = await getDocs(collection(db, ATTENDANCE));
  return mapAttendanceDocs(snap);
}

/** Team-wide collectible report (all members). */
export function computeTeamCollectibleReport(members, allRecords) {
  const byMemberId = new Map();
  for (const r of allRecords) {
    const id = r.memberID;
    if (!byMemberId.has(id)) byMemberId.set(id, []);
    byMemberId.get(id).push(r);
  }

  let totalPenalties = 0;
  let totalPaidMember = 0;
  let totalPaidOnRecords = 0;
  let totalCollectible = 0;
  const memberRows = [];

  for (const m of members) {
    const recs = byMemberId.get(m.memberID) || [];
    const s = computeMemberSummary(m, recs);
    totalPenalties += s.totalPenalties;
    totalPaidMember += s.amountPaid;
    totalPaidOnRecords += s.paidOnRecords;
    totalCollectible += s.remainingBalance;
    const paymentHistory = buildMemberPaymentHistory(m, recs);
    memberRows.push({ member: m, summary: s, paymentHistory });
  }

  memberRows.sort((a, b) => b.summary.remainingBalance - a.summary.remainingBalance);

  const allPayments = [];
  for (const row of memberRows) {
    for (const p of row.paymentHistory) {
      allPayments.push({ member: row.member, ...p });
    }
  }
  allPayments.sort((a, b) => {
    const ta = a.paidAt?.getTime() ?? 0;
    const tb = b.paidAt?.getTime() ?? 0;
    return tb - ta;
  });

  return {
    totalPenalties,
    totalPaidMember,
    totalPaidOnRecords,
    totalPaid: totalPaidMember + totalPaidOnRecords,
    totalCollectible,
    memberRows,
    allPayments,
  };
}

export async function getAttendanceForMemberOnDate(memberID, dateKey) {
  const id = memberID.trim().toUpperCase();
  const q = query(
    collection(db, ATTENDANCE),
    where("memberID", "==", id),
    where("date", "==", dateKey)
  );
  const snap = await getDocs(q);
  if (snap.empty) return [];
  return sortByTimeDesc(mapAttendanceDocs(snap));
}

/** Always saves a new check-in row (each scan = new record in history). */
export async function recordAttendance(member, serviceType = "Sunday Service") {
  const now = new Date();
  const dateKey = formatDateKey(now);
  const memberID = member.memberID.trim().toUpperCase();

  const todayRows = await getAttendanceForMemberOnDate(memberID, dateKey);
  const isRepeatToday = todayRows.length > 0;

  await loadPenaltyRules();
  const penalty = calculatePenalty(now);
  const timeInTs = Timestamp.fromDate(now);
  const timeInMs = now.getTime();

  const record = {
    memberID,
    name: member.name,
    role: member.role,
    section: member.section,
    date: dateKey,
    timeIn: timeInTs,
    timeInMs,
    timeInISO: now.toISOString(),
    checkedInAt: serverTimestamp(),
    serviceType,
    status: "Present",
    penalty,
    penaltyPaid: false,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, ATTENDANCE), record);

  return {
    status: "success",
    isRepeatToday,
    record: normalizeAttendanceRecord(ref.id, {
      ...record,
      checkedInAt: timeInTs,
    }),
  };
}

/** Admin: update check-in time and penalty on an attendance row. */
export async function updateAttendanceRecord(attendanceId, { checkInDate, penalty, penaltyPaid }) {
  if (!attendanceId) throw new Error("Missing attendance record.");
  const when = checkInDate instanceof Date ? checkInDate : new Date(checkInDate);
  if (Number.isNaN(when.getTime())) throw new Error("Invalid check-in time.");

  const prevSnap = await getDoc(doc(db, ATTENDANCE, attendanceId));
  const prev = prevSnap.exists() ? prevSnap.data() : {};
  const wasPaid = !!(prev.penaltyPaid && (Number(prev.penalty) || 0) > 0);

  const timeInTs = Timestamp.fromDate(when);
  const penaltyAmount = Math.max(0, Math.round(Number(penalty) || 0));
  const isPaid = penaltyAmount > 0 && !!penaltyPaid;
  const payload = {
    date: formatDateKey(when),
    timeIn: timeInTs,
    timeInMs: when.getTime(),
    timeInISO: when.toISOString(),
    penalty: penaltyAmount,
    penaltyPaid: isPaid,
    adminEdited: true,
    updatedAt: serverTimestamp(),
  };
  if (isPaid && !wasPaid) {
    const paidNow = new Date();
    payload.penaltyPaidAt = Timestamp.fromDate(paidNow);
    payload.penaltyPaidAtMs = paidNow.getTime();
    payload.penaltyPaidAtISO = paidNow.toISOString();
  } else if (!isPaid) {
    payload.penaltyPaidAt = deleteField();
    payload.penaltyPaidAtMs = deleteField();
    payload.penaltyPaidAtISO = deleteField();
  }

  await setDoc(doc(db, ATTENDANCE, attendanceId), payload, { merge: true });
  const updatedSnap = await getDoc(doc(db, ATTENDANCE, attendanceId));
  return normalizeAttendanceRecord(attendanceId, updatedSnap.data() || payload);
}

export async function getAttendanceInRange(filters = {}) {
  let q = collection(db, ATTENDANCE);
  const constraints = [];
  if (filters.date) {
    constraints.push(where("date", "==", filters.date));
  }
  if (filters.memberID) {
    constraints.push(where("memberID", "==", filters.memberID));
  }
  if (constraints.length) {
    q = query(q, ...constraints, orderBy("timeIn", "asc"));
  } else {
    q = query(q, orderBy("date", "desc"), orderBy("timeIn", "desc"));
  }
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (filters.memberID && !filters.date) {
    rows = rows.filter((r) => r.memberID === filters.memberID);
  }
  if (filters.nameSearch) {
    const term = filters.nameSearch.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(term));
  }
  return rows;
}

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.includes("YOUR_");
}
