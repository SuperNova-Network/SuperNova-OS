/*
 * @mentions in chat messages. A mention is "@" followed by a name, at the start of the text or after a space or
 * punctuation (so an email address isn't one). It can name a person (@alex), a role by the name written with
 * dashes (@moderator, @beta-testers), or @everyone / @here. Roles come before people with the same name.
 *
 * Only what exists, and what the sender is allowed to ping, counts: anything else stays plain text and pings
 * nobody. The result is stored with the message so history still shows who was pinged.
 */

export const MAX_MENTIONS = 10; // distinct mentions that count in one message; more are plain text
const TOKEN = /(^|[^A-Za-z0-9_@.\/-])@([A-Za-z0-9][A-Za-z0-9._-]{0,31})/g;

/**
 * parseMentions(text, { person(name) -> username or null, role(slug) -> { slug, mentionable } or null,
 *   everyone: may ping @everyone and @here, anyRole: may ping roles that aren't pingable })
 * -> { users: [username], roles: [slug], everyone: bool, here: bool }
 */
export function parseMentions(text, { person, role, everyone = false, anyRole = false }) {
  const out = { users: [], roles: [], everyone: false, here: false };
  let counted = 0;
  for (const match of String(text ?? "").matchAll(TOKEN)) {
    if (counted >= MAX_MENTIONS) break;
    let token = match[2];
    // "@bob." at the end of a sentence is @bob: shed trailing punctuation until something matches.
    while (token) {
      const lower = token.toLowerCase();
      let found = false;
      if (lower === "everyone" || lower === "here") {
        if (everyone && !out[lower]) { out[lower] = true; counted++; }
        found = true;
      } else {
        const r = role(lower);
        if (r) {
          if ((r.mentionable || anyRole) && !out.roles.includes(r.slug)) { out.roles.push(r.slug); counted++; }
          found = true;
        } else {
          const name = person(token);
          if (name) {
            if (!out.users.some((u) => u.toLowerCase() === name.toLowerCase())) { out.users.push(name); counted++; }
            found = true;
          }
        }
      }
      if (found || !/[._-]$/.test(token)) break;
      token = token.slice(0, -1);
    }
  }
  return out;
}

export const hasMentions = (m) => Boolean(m && (m.users.length || m.roles.length || m.everyone || m.here));
