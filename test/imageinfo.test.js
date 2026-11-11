import { test } from "node:test";
import assert from "node:assert/strict";
import { imageInfo } from "../src/imageinfo.js";
import { samples } from "./images.js";


for (const [name, [data, mime, width, height]] of Object.entries(samples)) {
  test(`imageInfo reads a ${name}`, () => {
    assert.deepEqual(imageInfo(Buffer.from(data, "base64")), { mime, width, height });
  });
}

test("imageInfo refuses anything that is not a supported raster image", () => {
  const text = (value) => Buffer.from(value);
  assert.equal(imageInfo(text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
  assert.equal(imageInfo(text("<!doctype html><script>alert(1)</script>")), null);
  assert.equal(imageInfo(text("GIF89a")), null, "truncated");
  assert.equal(imageInfo(Buffer.alloc(64)), null);
  assert.equal(imageInfo(null), null);
  assert.equal(imageInfo("GIF89a"), null, "strings are not buffers");
  const empty = Buffer.from(samples.png[0], "base64");
  empty.writeUInt32BE(0, 16); // width 0
  assert.equal(imageInfo(empty), null);
});

test("imageInfo reports a huge picture's size without decoding it", () => {
  const big = Buffer.from(samples.png[0], "base64");
  big.writeUInt32BE(30000, 16);
  big.writeUInt32BE(30000, 20);
  assert.deepEqual(imageInfo(big), { mime: "image/png", width: 30000, height: 30000 });
});
