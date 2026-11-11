/*
 * What an uploaded image really is, read from its first bytes: its type and its
 * pixel size. Used for profile pictures and chat GIFs, where the browser's
 * "Content-Type" claim from the uploader can't be trusted, and where a tiny file
 * that decodes to a gigantic picture could freeze everyone's tab.
 *
 * Only PNG, JPEG, GIF and WebP are recognised, so nothing that can carry script
 * (SVG, HTML) is ever accepted.
 */

/** { mime, width, height } for a supported image, or null for anything else. */
export function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  return png(buffer) ?? gif(buffer) ?? jpeg(buffer) ?? webp(buffer);
}

function png(b) {
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
  return size("image/png", b.readUInt32BE(16), b.readUInt32BE(20));
}

function gif(b) {
  const header = b.toString("latin1", 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  return size("image/gif", b.readUInt16LE(6), b.readUInt16LE(8));
}

function jpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) { at++; continue; }
    const marker = b[at + 1];
    if (marker === 0xff) { at++; continue; }            // fill bytes
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; } // no length
    const length = b.readUInt16BE(at + 2);
    // Start-of-frame markers carry the size (not C4 = tables, C8 = reserved, CC = arithmetic tables).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return size("image/jpeg", b.readUInt16BE(at + 7), b.readUInt16BE(at + 5));
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webp(b) {
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return size("image/webp", b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return size("image/webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (kind === "VP8X" && b.length >= 30) {
    return size("image/webp", b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  }
  return null;
}

function size(mime, width, height) {
  return width > 0 && height > 0 ? { mime, width, height } : null;
}
