import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit } from "./chatkit.js";

// Star ratings on store apps, and the apps admins feature on the front page.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, kit, boss, made = 0;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-ratings-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.4");
  boss = await kit.person("Boss");
  await boss.post("/api/admin/store/settings", { approval: "auto" });
});
after(async () => {
  kit?.closeAll();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function publish(maker, name = `Rated ${made + 1}`) {
  made++;
  const response = await maker.post("/api/store/apps", { name, description: `${name} is a test app`, url: `https://site${made}.example.org/`, category: "other" });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.app;
}
const listed = async (who, query = "") => (await who.get(`/api/store/apps${query}`)).data;

test("you rate an app you have, once, from 1 to 5, and can change or take it back", options, async () => {
  const [maker, ann, bea] = [await kit.person(), await kit.person(), await kit.person()];
  const app = await publish(maker);
  const rate = (who, stars) => who.post(`/api/store/apps/${app.id}/rate`, { stars });
  assert.equal((await kit.browser().post(`/api/store/apps/${app.id}/rate`, { stars: 5 })).status, 401);
  assert.equal((await rate(ann, 5)).status, 400, "get it first");
  await ann.post(`/api/store/apps/${app.id}/install`);
  await bea.post(`/api/store/apps/${app.id}/install`);
  assert.equal((await rate(maker, 5)).status, 400, "not your own");
  for (const bad of [6, 0.5, "many", null, -1]) assert.equal((await rate(ann, bad)).status, 400, `stars ${bad}`);
  const first = await rate(ann, 5);
  assert.equal(first.status, 200);
  assert.deepEqual([first.data.app.rating, first.data.app.ratings, first.data.app.mine], [5, 1, 5]);
  const second = await rate(bea, 2);
  assert.deepEqual([second.data.app.rating, second.data.app.ratings], [3.5, 2]);
  // changing it doesn't add a vote
  const changed = await rate(ann, 4);
  assert.deepEqual([changed.data.app.rating, changed.data.app.ratings], [3, 2]);
  // the list carries the average and what you gave
  const seen = (await listed(ann)).apps.find((a) => a.id === app.id);
  assert.deepEqual([seen.rating, seen.ratings, seen.mine], [3, 2, 4]);
  assert.equal((await listed(maker)).apps.find((a) => a.id === app.id).mine, undefined);
  // taking it back
  const back = await rate(ann, 0);
  assert.deepEqual([back.data.app.rating, back.data.app.ratings], [2, 1]);
  assert.equal((await rate(ann, 0)).status, 200, "taking back nothing is fine");
});

test("top rated puts well-liked apps first, and one lonely five star doesn't beat many good ones", options, async () => {
  const maker = await kit.person();
  const [lonely, loved, meh] = [await publish(maker, "Lonely five"), await publish(maker, "Loved by many"), await publish(maker, "Meh app")];
  const fans = [await kit.person(), await kit.person(), await kit.person(), await kit.person()];
  for (const fan of fans) for (const app of [lonely, loved, meh]) await fan.post(`/api/store/apps/${app.id}/install`);
  await fans[0].post(`/api/store/apps/${lonely.id}/rate`, { stars: 5 });
  for (const fan of fans) await fan.post(`/api/store/apps/${loved.id}/rate`, { stars: 5 });
  for (const fan of fans) await fan.post(`/api/store/apps/${meh.id}/rate`, { stars: 2 });
  const order = (await listed(fans[0], "?sort=rating&q=")).apps.filter((a) => [lonely.id, loved.id, meh.id].includes(a.id)).map((a) => a.name);
  assert.deepEqual(order, ["Loved by many", "Lonely five", "Meh app"]);
});

test("admins feature live apps (up to eight), they show first on the front page, and others can't", options, async () => {
  const [maker, ann] = [await kit.person(), await kit.person()];
  const apps = [];
  for (let i = 0; i < 9; i++) apps.push(await publish(boss, `Shelf ${i}`)); // admins aren't held to the five-app limit
  assert.equal((await ann.post(`/api/admin/store/apps/${apps[0].id}/feature`)).status, 403);
  assert.deepEqual((await listed(ann)).featured.filter((a) => a.name.startsWith("Shelf")), []);
  for (let i = 0; i < 8; i++) assert.equal((await boss.post(`/api/admin/store/apps/${apps[i].id}/feature`)).status, 200);
  assert.equal((await boss.post(`/api/admin/store/apps/${apps[8].id}/feature`)).status, 400, "eight at most");
  const shelf = (await listed(ann)).featured;
  assert.equal(shelf.length, 8);
  assert.equal(shelf[0].name, "Shelf 7", "the newest choice first");
  assert.ok(shelf.every((a) => a.featured));
  assert.equal((await boss.post(`/api/admin/store/apps/${apps[0].id}/feature`, { featured: false })).data.app.featured, false);
  assert.equal((await listed(ann)).featured.length, 7);
  assert.equal((await boss.post(`/api/admin/store/apps/${apps[8].id}/feature`)).status, 200, "room again");
  // a paused or rejected app isn't shown on the shelf, and can't be featured
  const second = await boss.post("/api/admin/store/settings", { approval: "manual" });
  assert.equal(second.status, 200);
  const waiting = await publish(maker, "Waiting");
  assert.equal(waiting.status ?? "pending", "pending");
  assert.equal((await boss.post(`/api/admin/store/apps/${waiting.id}/feature`)).status, 400, "only live apps");
  assert.equal((await boss.post("/api/admin/store/apps/99999/feature")).status, 404);
});
