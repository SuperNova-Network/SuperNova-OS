#!/usr/bin/env node
/*
 * Writes build-info.json (the version, commit and date shown faintly in the taskbar). Run it before a deploy,
 * because the Docker image has no .git:   npm run build-info && fly deploy
 */
import { fileURLToPath } from "node:url";
import { writeBuildInfo } from "../src/buildinfo.js";

const info = writeBuildInfo(fileURLToPath(new URL("../", import.meta.url)));
console.log(`build-info.json: ${info.tag ?? "(no tag)"}${info.ahead ? `+${info.ahead}` : ""} ${info.commit}${info.dirty ? " (uncommitted changes)" : ""}`);
