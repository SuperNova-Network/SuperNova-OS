#!/usr/bin/env node
/*
 * Writes build-info.json (the version, commit and date shown faintly in the taskbar). Run it before a deploy,
 * because the Docker image has no .git:   npm run build-info && fly deploy
 */
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { datesOf, parseWhatsNew } from "../src/whatsnew.js";
import { writeBuildInfo } from "../src/buildinfo.js";

const info = writeBuildInfo(fileURLToPath(new URL("../", import.meta.url)));
console.log(`build-info.json: ${info.tag ?? "(no tag)"}${info.ahead ? `+${info.ahead}` : ""} ${info.commit}${info.dirty ? " (uncommitted changes)" : ""}`);

// When each "What's new" item was written (the image has no .git to ask).
const root = fileURLToPath(new URL("../", import.meta.url));
const changelog = `${root}CHANGELOG.md`;
const dates = datesOf(parseWhatsNew(readFileSync(changelog, "utf8")), changelog);
writeFileSync(`${root}whatsnew-dates.json`, `${JSON.stringify(dates, null, 2)}\n`);
console.log(`whatsnew-dates.json: ${Object.keys(dates).length} dated items`);
