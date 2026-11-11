import { test } from "node:test";
import assert from "node:assert/strict";
import { imageInfo } from "../src/imageinfo.js";

// Real files written by ImageMagick (one solid colour each), so the parser is checked
// against actual encoder output, not against bytes made up to fit it.
const samples = {
  png: ["iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFAQMAAACzVGSbAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURcgePMPouXoAAAAHdElNRQfqCwsLHAAx+JboAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTExVDExOjI4OjAwKzAwOjAw7gQceAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0xMVQxMToyODowMCswMDowMJ9ZpMQAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMTFUMTE6Mjg6MDArMDA6MDDITIUbAAAAC0lEQVQI12NggAEAAAoAAef42voAAAAASUVORK5CYII=", "image/png", 7, 5],
  gif: ["R0lGODlhCQAEAPAAAMgePAAAACH5BAAAAAAALAAAAAAJAAQAAAIFhI+pywUAOw==", "image/gif", 9, 4],
  jpeg: ["/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAGAAsDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AhSabdAf/2Q==", "image/jpeg", 11, 6],
  "lossy webp": ["UklGRjgAAABXRUJQVlA4ICwAAABwAQCdASoNAAgAAgA0JaACdAFAAAD+7/3DBskU3I/+ysf/6Vj//SsfwqAAAA==", "image/webp", 13, 8],
  "lossless webp": ["UklGRiIAAABXRUJQVlA4TBYAAAAvDoAAAAdQjyKXp/8BgCD8b5uI6H8K", "image/webp", 15, 3],
};

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
