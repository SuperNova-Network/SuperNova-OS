/*
 * Reports of chat messages and profiles. (Apps have their own, in storedb.js; the Admin Panel's Reports page shows
 * all of them together.) A report is one person saying one thing is wrong, with a reason and an optional note.
 * Reports about the same message or profile are grouped by `ref` ("m:<message id>" or "p:<user id>"), a person
 * can have one open report per thing, and the text of a reported message is kept with the report so it is still
 * there to read after the message is deleted.
 */
import { AdminError } from "./accountsdb.js";

export const REASONS = {
  message: [
    { id: "spam", label: "Spam or flooding" },
    { id: "harassment", label: "Harassment or bullying" },
    { id: "inappropriate", label: "Inappropriate or harmful content" },
    { id: "scam", label: "A scam or a dangerous link" },
    { id: "other", label: "Something else" },
  ],
  profile: [
    { id: "inappropriate", label: "Inappropriate picture, name or bio" },
    { id: "impersonation", label: "Pretending to be someone else" },
    { id: "harassment", label: "Harassment or bullying" },
    { id: "other", label: "Something else" },
  ],
};
export const NOTE_MAX = 300;

/** Add a report. `message` ({ id, body, media_kind, channel }) for a message. Returns how many people reported this thing. */
export function addReport(db, { kind, reporterId, targetUserId, message = null, reason, note }) {
  if (!REASONS[kind]?.some((r) => r.id === reason)) throw new AdminError(400, "Pick what is wrong.");
  const text = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  const ref = kind === "message" ? `m:${message.id}` : `p:${targetUserId}`;
  const snapshot = kind === "message" ? JSON.stringify({ id: message.id, text: String(message.body ?? "").slice(0, 400), gif: Boolean(message.media_kind), channel: message.channel ?? null }) : null;
  try {
    db.prepare("INSERT INTO reports (kind, ref, target_user_id, reporter_id, reason, note, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(kind, ref, targetUserId, reporterId, reason, text || null, snapshot, Date.now());
  } catch (error) {
    if (/UNIQUE/.test(String(error?.message))) throw new AdminError(409, "You already reported this. An admin will look at it.");
    throw error;
  }
  return db.prepare("SELECT COUNT(*) AS n FROM reports WHERE ref = ? AND status = 'open'").get(ref).n;
}

const labelOf = (kind, reason) => REASONS[kind]?.find((r) => r.id === reason)?.label ?? reason;

/** The open reports of messages and profiles, one entry per thing reported, newest first. */
export function openReports(db) {
  const rows = db.prepare(`SELECT r.id, r.kind, r.ref, r.reason, r.note, r.snapshot, r.created_at, r.target_user_id,
      reporter.username AS reporter, target.username AS target, target.avatar_version AS avatar, target.banned_at AS banned
    FROM reports r JOIN users reporter ON reporter.id = r.reporter_id JOIN users target ON target.id = r.target_user_id
    WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 1000`).all();
  const groups = new Map();
  for (const row of rows) {
    let group = groups.get(row.ref);
    if (!group) {
      let snap = null;
      try { snap = row.snapshot ? JSON.parse(row.snapshot) : null; } catch { /* kept without it */ }
      const live = snap ? db.prepare("SELECT deleted_at FROM chat_messages WHERE id = ?").get(snap.id) : null;
      group = {
        ref: row.ref, kind: row.kind, at: row.created_at, count: 0, reasons: [], reports: [],
        user: { username: row.target, avatar: row.avatar ?? 0, banned: Boolean(row.banned) },
        ...(snap ? { message: { ...snap, deleted: !live || live.deleted_at !== null } } : {}),
      };
      groups.set(row.ref, group);
    }
    group.count++;
    group.reports.push({ id: row.id, reporter: row.reporter, reason: row.reason, label: labelOf(row.kind, row.reason), note: row.note, at: row.created_at });
    const seen = group.reasons.find((r) => r.reason === row.reason);
    if (seen) seen.count++; else group.reasons.push({ reason: row.reason, label: labelOf(row.kind, row.reason), count: 1 });
  }
  return [...groups.values()];
}

export const countOpen = (db) => db.prepare("SELECT COUNT(DISTINCT ref) AS n FROM reports WHERE status = 'open'").get().n;

/** Close every open report about one thing. Returns how many. */
export function resolveRef(db, ref, by, status = "handled") {
  if (status !== "handled" && status !== "dismissed") throw new AdminError(400, "A report is handled or dismissed.");
  return db.prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE ref = ? AND status = 'open'").run(status, String(by), Date.now(), String(ref)).changes;
}
