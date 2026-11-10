#!/usr/bin/env node
/*
 * Manage the site from the command line: the same things as Settings > Admin. Works on
 * the same database as the server (DATA_DIR), also while it is running: setting
 * changes reach it within seconds, and a ban reaches open proxy connections within 30.
 * Needs no admin account, so it is also the way back in after a mistake.
 *
 *   npm run admin -- status
 *   npm run admin -- accounts off|optional|required
 *   npm run admin -- signup invite|open|closed
 *   npm run admin -- make-admin <username>
 *   npm run admin -- remove-admin <username>
 *   npm run admin -- invite [--uses N] [--days N] [--label TEXT]
 *   npm run admin -- invites
 *   npm run admin -- revoke <id>
 *   npm run admin -- users [search]
 *   npm run admin -- ban <username> [reason...]
 *   npm run admin -- unban <username>
 *
 * On Fly.io:  fly ssh console -C "npm run admin -- invite --uses 30"
 */
import { parseArgs } from "node:util";
import config from "../config.js";
import {
  AdminError, adminCount, createInvite, getSiteSettings, listInvites, listUsers, openDatabase, revokeInvite,
  setAdmin, setBanned, setSiteSetting,
} from "../src/accountsdb.js";

const USAGE = `Usage: npm run admin -- <command>

  status                                      how accounts are set up
  accounts off|optional|required              turn accounts off, make them optional, or require sign-in
  signup invite|open|closed                   who can create an account
  make-admin <username>                       give someone Settings > Admin
  remove-admin <username>                     take it away
  invite [--uses N] [--days N] [--label TEXT]   make an invite code (default: 1 use, 7 days; --days 0 never expires)
  invites                                     list invite codes
  revoke <id>                                 stop an invite code from working
  users [search]                              list accounts
  ban <username> [reason...]                  sign someone out everywhere and keep them out
  unban <username>                            let them back in

Data: ${config.accounts.dataDir}/accounts.db (DATA_DIR)`;

const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");

function table(rows, columns) {
  if (!rows.length) return console.log("(none)");
  const widths = columns.map(([title, get]) => Math.max(title.length, ...rows.map((row) => String(get(row)).length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(columns.map(([title]) => title)));
  for (const row of rows) console.log(line(columns.map(([, get]) => get(row))));
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      uses: { type: "string", default: "1" },
      days: { type: "string", default: "7" },
      label: { type: "string", default: "" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help) return console.log(USAGE);

  const db = await openDatabase(config.accounts.dataDir);
  const admins = new Set(config.accounts.admins);
  const fixed = { mode: config.accounts.mode, signup: config.accounts.signup };
  try {
    switch (command) {
      case "status": {
        const stored = getSiteSettings(db);
        const show = (key, variable, fallback) => (fixed[key] ? `${fixed[key]} (fixed by ${variable} on the server)` : stored[key] ?? `${fallback} (default)`);
        console.log(`accounts: ${show("mode", "ACCOUNTS", "off")}`);
        console.log(`sign-up:  ${show("signup", "ACCOUNTS_SIGNUP", "invite")}`);
        const names = listUsers(db, { admins }).filter((u) => u.admin).map((u) => u.username);
        console.log(`admins:   ${names.length ? names.join(", ") : "none yet: start the server for a setup link, or use make-admin"}${admins.size ? ` (ADMINS: ${[...admins].join(", ")})` : ""}`);
        console.log(`data:     ${config.accounts.dataDir}/accounts.db`);
        break;
      }
      case "accounts":
      case "signup": {
        const key = command === "accounts" ? "mode" : "signup";
        if (fixed[key]) throw new AdminError(409, `${key === "mode" ? "ACCOUNTS" : "ACCOUNTS_SIGNUP"} is set on the server, so this is fixed there.`);
        setSiteSetting(db, key, rest[0], "command line");
        console.log(`${command === "accounts" ? "Accounts" : "Sign-up"}: ${rest[0]}. A running server picks this up within a few seconds.`);
        if (key === "mode" && rest[0] !== "off" && !adminCount(db) && !admins.size) console.log("Nobody is an admin yet: use make-admin, or the setup link the server prints.");
        break;
      }
      case "make-admin":
      case "remove-admin":
        if (!rest[0]) throw new AdminError(400, "Who? Give a username.");
        setAdmin(db, rest[0], command === "make-admin", { serverAdmins: admins });
        console.log(command === "make-admin" ? `${rest[0]} is now an admin.` : `${rest[0]} is no longer an admin.`);
        break;
      case "invite": {
        const { code, invite } = createInvite(db, { label: values.label, maxUses: values.uses, expiresInDays: values.days, createdBy: "command line" });
        console.log(code);
        console.error(`${invite.maxUses} use${invite.maxUses === 1 ? "" : "s"}, ${invite.expiresAt ? `expires ${date(invite.expiresAt)} UTC` : "never expires"}. It won't be shown again.`);
        break;
      }
      case "invites":
        table(listInvites(db), [
          ["ID", (i) => i.id], ["CODE", (i) => `…${i.hint}`], ["LABEL", (i) => i.label || "-"], ["USES", (i) => `${i.uses}/${i.maxUses}`],
          ["EXPIRES (UTC)", (i) => date(i.expiresAt)], ["STATE", (i) => i.state], ["BY", (i) => i.createdBy ?? "-"],
        ]);
        break;
      case "revoke":
        if (!rest[0]) throw new AdminError(400, "Which invite? Give its ID (see `invites`).");
        revokeInvite(db, rest[0]);
        console.log(`Invite ${rest[0]} revoked.`);
        break;
      case "users":
        table(listUsers(db, { search: rest[0] ?? "", admins }), [
          ["USERNAME", (u) => u.username + (u.admin ? " (admin)" : "")], ["JOINED (UTC)", (u) => date(u.createdAt)],
          ["LAST SEEN", (u) => date(u.lastSeenAt)], ["INVITE", (u) => u.invite ?? "-"],
          ["BANNED", (u) => (u.banned ? `yes${u.banReason ? `: ${u.banReason}` : ""}` : "")],
        ]);
        break;
      case "ban":
        if (!rest[0]) throw new AdminError(400, "Who? Give a username.");
        setBanned(db, rest[0], true, { reason: rest.slice(1).join(" "), admins });
        console.log(`${rest[0]} is banned and signed out everywhere (open proxy connections close within 30 seconds).`);
        break;
      case "unban":
        if (!rest[0]) throw new AdminError(400, "Who? Give a username.");
        setBanned(db, rest[0], false);
        console.log(`${rest[0]} can sign in again.`);
        break;
      default:
        throw new AdminError(400, `Unknown command "${command}".\n\n${USAGE}`);
    }
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof AdminError || err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? err.message : err);
  process.exit(1);
});
