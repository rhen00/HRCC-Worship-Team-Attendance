import {
  formatDisplayDate,
  penaltyLabel,
  formatTime,
  formatDateTime,
  getAttendanceDateTime,
} from "./penalty.js";
import { getPenaltyPaidAt } from "./firebase-app.js";

export function attendanceToCSV(rows) {
  const headers = [
    "Date",
    "Member ID",
    "Name",
    "Role",
    "Section",
    "Time In (Manila)",
    "Timestamp (ms)",
    "Service",
    "Status",
    "Penalty (PHP)",
    "Penalty Status",
    "Penalty paid",
    "Paid at (Manila)",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const timeIn = getAttendanceDateTime(r);
    const line = [
      escapeCsv(r.date),
      escapeCsv(r.memberID),
      escapeCsv(r.name),
      escapeCsv(r.role || ""),
      escapeCsv(r.section || ""),
      escapeCsv(formatDateTime(timeIn)),
      escapeCsv(String(r.timeInMs ?? timeIn.getTime())),
      escapeCsv(r.serviceType || "Sunday Service"),
      escapeCsv(r.status || "Present"),
      String(r.penalty ?? 0),
      escapeCsv(penaltyLabel(r.penalty ?? 0)),
      r.penaltyPaid ? "Yes" : "No",
      escapeCsv(
        r.penaltyPaid
          ? (() => {
              const d = getPenaltyPaidAt(r);
              return d && !Number.isNaN(d.getTime()) ? formatDateTime(d) : "Date not recorded";
            })()
          : ""
      ),
    ];
    lines.push(line.join(","));
  }
  return lines.join("\n");
}

function escapeCsv(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCSV(content, filename) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function collectibleReportToCSV(report) {
  const headers = [
    "Member ID",
    "Name",
    "Role",
    "Total penalties (₱)",
    "Paid on member (₱)",
    "Paid on Sundays (₱)",
    "Total paid (₱)",
    "Collectible (₱)",
    "Late Sundays",
    "Late & paid",
  ];
  const lines = [headers.join(",")];
  for (const { member, summary: s } of report.memberRows) {
    lines.push(
      [
        escapeCsv(member.memberID),
        escapeCsv(member.name),
        escapeCsv(member.role || ""),
        String(s.totalPenalties),
        String(s.amountPaid),
        String(s.paidOnRecords),
        String(s.totalPaid),
        String(s.remainingBalance),
        String(s.lateTotal),
        String(s.latePaid),
      ].join(",")
    );
  }
  lines.push("");
  lines.push(
    [
      "TOTAL",
      "",
      "",
      String(report.totalPenalties),
      String(report.totalPaidMember),
      String(report.totalPaidOnRecords),
      String(report.totalPaid),
      String(report.totalCollectible),
      "",
      "",
    ].join(",")
  );
  return lines.join("\n");
}

export function paymentsReportToCSV(report) {
  const headers = [
    "Member ID",
    "Name",
    "Payment type",
    "Description",
    "Amount (₱)",
    "Paid at (Manila)",
    "Sunday date",
  ];
  const lines = [headers.join(",")];
  const all = report.allPayments || [];
  for (const p of all) {
    const paidLabel =
      p.paidAt && !Number.isNaN(p.paidAt.getTime()) ? formatDateTime(p.paidAt) : "Date not recorded";
    lines.push(
      [
        escapeCsv(p.member.memberID),
        escapeCsv(p.member.name),
        escapeCsv(p.type === "sunday" ? "Sunday penalty" : "Lump sum"),
        escapeCsv(p.description || ""),
        String(p.amount),
        escapeCsv(paidLabel),
        escapeCsv(p.sundayDate ? formatDisplayDate(p.sundayDate) : ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export function summaryFromRows(rows) {
  const present = rows.length;
  const penalties = rows.reduce((sum, r) => sum + (r.penalty || 0), 0);
  const onTime = rows.filter((r) => (r.penalty || 0) === 0).length;
  const late = rows.filter((r) => r.penalty === 20).length;
  const veryLate = rows.filter((r) => r.penalty === 30).length;
  return { present, penalties, onTime, late, veryLate };
}
