/*
 * Achievements: things to do on the site, each unlocked once and kept with the account. They are shown in the
 * trophy beside the battery in the taskbar.
 *
 * Most come from what the server already knows (messages sent, friends made, apps published, ...): they are worked
 * out from the database whenever something relevant happens, so nothing can drift out of step. A few are things only the
 * desktop can see (opened the Browser, changed the wallpaper): it reports those as named events, from a fixed list, and
 * the server counts them. A daily "I'm here" event keeps the streak. An achievement is never taken away.
 */
import express from "express";
import { AdminError } from "./accountsdb.js";
import { HttpError, guardWrites } from "./http.js";
import { createLimiter } from "./ratelimit.js";

const DAY = 24 * 60 * 60 * 1000;

export const GROUPS = ["Getting started", "Chat", "Friends", "App Store", "Exploring", "Streaks", "Milestones"];

// id, name, what to do, a picture (see the desktop's achievements.js), group, the counter it watches, how many, points.
const A = (id, name, description, glyph, group, stat, goal, points) => ({ id, name, description, glyph, group, stat, goal, points });
export const DEFINITIONS = [
  A("welcome", "Welcome aboard", "Sign in to SuperNova.", "flag", "Getting started", "signed_in", 1, 5),
  A("face", "Say cheese", "Set a profile picture.", "camera", "Getting started", "avatar", 1, 10),
  A("bio", "About me", "Write a bio for your profile card.", "pencil", "Getting started", "bio", 1, 10),
  A("renamed", "A new name", "Change your username.", "tag", "Getting started", "renamed", 1, 10),
  A("whatsnew", "In the know", "Read what's new.", "star", "Getting started", "ev_whatsnew", 1, 5),

  A("first_words", "First words", "Send your first chat message.", "chat", "Chat", "messages", 1, 5),
  A("chatterbox", "Chatterbox", "Send 25 chat messages.", "chat", "Chat", "messages", 25, 15),
  A("gift_of_gab", "Gift of the gab", "Send 250 chat messages.", "chat", "Chat", "messages", 250, 40),
  A("replier", "Conversation starter", "Reply to someone's message.", "chat", "Chat", "replies", 1, 10),
  A("reactor", "Reaction time", "React to 10 messages.", "heart", "Chat", "reactions_given", 10, 10),
  A("loved", "Crowd favourite", "Get 10 reactions on your messages.", "heart", "Chat", "reactions_received", 10, 25),
  A("channel_surfer", "Channel surfer", "Post in 3 different channels.", "compass", "Chat", "channels_posted", 3, 15),

  A("friendly", "Friendly", "Make your first friend.", "user", "Friends", "friends", 1, 10),
  A("popular", "Popular", "Have 5 friends.", "user", "Friends", "friends", 5, 25),

  A("collector", "Collector", "Get 5 apps from the App Store.", "download", "App Store", "apps_installed", 5, 15),
  A("critic", "Critic", "Rate 3 apps.", "star", "App Store", "ratings_given", 3, 15),
  A("maker", "Maker", "Publish an app in the App Store.", "store", "App Store", "apps_published", 1, 25),
  A("hit_maker", "Hit maker", "Have one of your apps installed 10 times.", "store", "App Store", "max_installs", 10, 50),

  A("web_surfer", "Web surfer", "Open the Browser.", "globe", "Exploring", "ev_browser_opened", 1, 5),
  A("search_party", "Search party", "Search the web from the taskbar.", "compass", "Exploring", "ev_web_search", 1, 5),
  A("decorator", "Interior decorator", "Change your wallpaper.", "palette", "Exploring", "ev_wallpaper", 1, 10),
  A("colour_me", "Colour me", "Change the accent colour.", "palette", "Exploring", "ev_accent", 1, 5),
  A("pinned", "Pinned down", "Pin an app to the taskbar.", "pin", "Exploring", "ev_pin", 1, 5),
  A("shortcut", "Shortcut maker", "Put a site on your desktop as its own app.", "bolt", "Exploring", "ev_shortcut", 1, 10),
  A("hackerman", "Hackerman", "Open the terminal.", "terminal", "Exploring", "ev_terminal", 1, 10),
  A("undercover", "Undercover", "Turn on tab cloaking.", "eye", "Exploring", "ev_cloak", 1, 10),
  A("tab_hoarder", "Tab hoarder", "Have 10 tabs open in the Browser at once.", "globe", "Exploring", "ev_tabs10", 1, 10),
  A("checkup", "Health check", "Open the network status to see which sites work.", "bolt", "Exploring", "ev_health", 1, 5),

  A("on_a_roll", "On a roll", "Visit three days in a row.", "fire", "Streaks", "streak", 3, 10),
  A("creature_of_habit", "Creature of habit", "Visit seven days in a row.", "fire", "Streaks", "streak", 7, 25),
  A("furniture", "Part of the furniture", "Visit thirty days in a row.", "fire", "Streaks", "streak", 30, 75),
  A("one_month", "One month in", "Have your account for a month.", "calendar", "Streaks", "account_days", 30, 15),
  A("old_timer", "Old timer", "Have your account for six months.", "calendar", "Streaks", "account_days", 180, 50),

  A("getting_good", "Getting good at this", "Unlock 10 achievements.", "trophy", "Milestones", "unlocked", 10, 25),
  A("overachiever", "Overachiever", "Unlock 25 achievements.", "trophy", "Milestones", "unlocked", 25, 100),
];
const BY_ID = new Map(DEFINITIONS.map((d) => [d.id, d]));
export const TOTAL_POINTS = DEFINITIONS.reduce((sum, d) => sum + d.points, 0);

/** What the desktop may report, and nothing else. "daily" is the streak's "I'm here today". */
export const EVENTS = new Set(["browser_opened", "web_search", "wallpaper", "accent", "pin", "shortcut", "terminal", "cloak", "tabs10", "health", "whatsnew"]);

/** The number of every counter an achievement can watch, for one person. */
export function statsOf(db, userId, now = Date.now()) {
  const n = (sql, ...args) => db.prepare(sql).get(...args)?.n ?? 0;
  const user = db.prepare("SELECT created_at, avatar_version, bio FROM users WHERE id = ?").get(userId);
  if (!user) return {};
  const stats = {
    signed_in: 1,
    avatar: user.avatar_version > 0 ? 1 : 0,
    bio: user.bio ? 1 : 0,
    renamed: n("SELECT COUNT(*) AS n FROM username_history WHERE user_id = ?", userId),
    messages: n("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ?", userId),
    replies: n("SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND reply_to IS NOT NULL", userId),
    channels_posted: n("SELECT COUNT(DISTINCT channel_id) AS n FROM chat_messages WHERE user_id = ?", userId),
    reactions_given: n("SELECT COUNT(*) AS n FROM chat_reactions WHERE user_id = ?", userId),
    reactions_received: n("SELECT COUNT(*) AS n FROM chat_reactions r JOIN chat_messages m ON m.id = r.message_id WHERE m.user_id = ? AND r.user_id <> ?", userId, userId),
    friends: n("SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (user_id = ? OR other_id = ?)", userId, userId),
    apps_installed: n("SELECT COUNT(*) AS n FROM store_installs WHERE user_id = ?", userId),
    ratings_given: n("SELECT COUNT(*) AS n FROM store_ratings WHERE user_id = ?", userId),
    apps_published: n("SELECT COUNT(*) AS n FROM store_apps WHERE owner_id = ? AND status = 'approved'", userId),
    max_installs: n("SELECT COALESCE(MAX(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM store_installs i JOIN store_apps a ON a.id = i.app_id WHERE a.owner_id = ? GROUP BY a.id)", userId),
    account_days: Math.max(0, Math.floor((now - user.created_at) / DAY)),
    unlocked: n("SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ?", userId),
  };
  for (const { key, value } of db.prepare("SELECT key, value FROM user_stats WHERE user_id = ?").all(userId)) stats[key] = value;
  return stats;
}

const shape = (def, stats, unlockedAt = null) => ({
  id: def.id, name: def.name, description: def.description, glyph: def.glyph, group: def.group, points: def.points,
  goal: def.goal, progress: Math.min(Number(stats[def.stat] ?? 0), def.goal), unlockedAt,
});

/**
 * options: db, userFor(req), site(), notify(userId, achievement) (called when something unlocks)
 * Returns { router, touch(userId), evaluate(userId), list(userId), close() }.
 */
export function createAchievements({ db, userFor = () => null, site = () => ({ mode: "optional" }), notify = () => {} }) {
  const limiter = createLimiter({ limit: 60, windowMs: 60_000 });
  const pending = new Set();
  let timer = null;

  /** Unlock whatever this person has now earned. Returns the achievements unlocked just now. */
  function evaluate(userId, now = Date.now()) {
    const fresh = [];
    for (let pass = 0; pass < 3; pass++) { // an unlock can itself earn a milestone, so go round again
      const have = new Set(db.prepare("SELECT achievement FROM user_achievements WHERE user_id = ?").all(userId).map((r) => r.achievement));
      const stats = statsOf(db, userId, now);
      if (!Object.keys(stats).length) return fresh;
      const added = [];
      for (const def of DEFINITIONS) {
        if (have.has(def.id) || (stats[def.stat] ?? 0) < def.goal) continue;
        const { changes } = db.prepare("INSERT OR IGNORE INTO user_achievements (user_id, achievement, unlocked_at) VALUES (?, ?, ?)").run(userId, def.id, now);
        if (changes) added.push(shape(def, stats, now));
      }
      if (!added.length) break;
      fresh.push(...added);
    }
    return fresh;
  }

  /** Something relevant happened to this person: check soon (checks are bunched together, so a busy moment costs one). */
  function touch(userId) {
    pending.add(userId);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const ids = [...pending];
      pending.clear();
      for (const id of ids) {
        try { for (const unlocked of evaluate(id)) notify(id, unlocked); } catch (error) { console.error("Achievements:", error.message); }
      }
    }, 400);
    timer.unref();
  }

  /** Every achievement with this person's progress, grouped in order. */
  function list(userId, now = Date.now()) {
    const stats = statsOf(db, userId, now);
    const when = new Map(db.prepare("SELECT achievement, unlocked_at FROM user_achievements WHERE user_id = ?").all(userId).map((r) => [r.achievement, r.unlocked_at]));
    const items = DEFINITIONS.map((def) => shape(def, stats, when.get(def.id) ?? null));
    const done = items.filter((a) => a.unlockedAt);
    return {
      achievements: items,
      groups: GROUPS,
      totals: { unlocked: done.length, total: items.length, points: done.reduce((sum, a) => sum + a.points, 0), possible: TOTAL_POINTS },
      streak: { current: stats.streak ?? 0, best: stats.best_streak ?? 0 },
    };
  }

  const setStat = db.prepare("INSERT INTO user_stats (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value");
  const getStat = (userId, key) => db.prepare("SELECT value FROM user_stats WHERE user_id = ? AND key = ?").get(userId, key)?.value ?? 0;

  /** The desktop says what the person did: one of EVENTS (counted), or "daily" with their local day ("2026-11-15"). */
  function record(userId, event, { day = "", now = Date.now() } = {}) {
    if (event === "daily") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
      if (!match) throw new AdminError(400, "Send today's date.");
      const number = Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY);
      if (!Number.isFinite(number) || Math.abs(number - Math.floor(now / DAY)) > 1) throw new AdminError(400, "That isn't today's date.");
      const last = getStat(userId, "last_day");
      let streak = getStat(userId, "streak");
      if (number === last) return;
      if (number === last + 1) streak += 1;
      else if (number > last + 1 || !last) streak = 1;
      else return; // a clock that went backwards: leave it
      setStat.run(userId, "last_day", number);
      setStat.run(userId, "streak", streak);
      if (streak > getStat(userId, "best_streak")) setStat.run(userId, "best_streak", streak);
      return;
    }
    if (!EVENTS.has(event)) throw new AdminError(400, "That isn't something that counts.");
    setStat.run(userId, `ev_${event}`, getStat(userId, `ev_${event}`) + 1);
  }

  // --- the API ----------------------------------------------------------------------------------

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(guardWrites());
  router.use(express.json({ limit: "2kb" }));
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  function requireUser(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, "Sign in to see your achievements.");
    if (site().mode === "off") throw new HttpError(403, "Achievements need accounts, which are turned off on this site.");
    return user;
  }

  router.get("/", handle((req, res) => {
    const user = requireUser(req);
    evaluate(user.id).forEach((unlocked) => notify(user.id, unlocked)); // catch up on anything earned while no page was open
    res.json(list(user.id));
  }));

  router.post("/event", handle((req, res) => {
    const user = requireUser(req);
    const wait = limiter.hit(String(user.id));
    if (wait) throw new HttpError(429, "Slow down a little.", { retryAfter: wait });
    record(user.id, String(req.body?.event ?? ""), { day: req.body?.day });
    const unlocked = evaluate(user.id);
    unlocked.forEach((a) => notify(user.id, a));
    res.json({ unlocked });
  }));

  router.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too big." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { router, touch, evaluate, list, record, close() { clearTimeout(timer); } };
}

/** The router for /api/achievements when accounts are unavailable. */
export function disabledAchievements() {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({ error: "Achievements need accounts, which aren't available on this site." }));
  return { router, touch() {}, close() {} };
}

export const definitionOf = (id) => BY_ID.get(id) ?? null;
