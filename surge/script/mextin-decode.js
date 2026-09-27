/*
 * mextin-decode.js — Mextin 加密订阅解密脚本（Loon / Surge / Quantumult X 通用）
 * =============================================================================
 * 机制（来自 wiki.mextinnet.com「订阅加密」+ 墨鱼手记 speedcat.sub.decode.js 逆向）:
 *   订阅响应体 = Base64( nonce[12] || AES-256-GCM密文 || tag[16] )
 *   密钥       = SHA256(SUBSCRIPTION_PASSWORD)          // 32 字节，密码每机场不同
 *   解密后才是真正的 ss:// vmess:// 等明文节点列表
 *
 * 用法：
 *   Loon  : [Script] http-response <url正则> script-path=<本文件> requires-body=true
 *   Surge : [Script] <name> type=http-response pattern=<url正则> script-path=<本文件> requires-body=true
 *   QX    : [rewrite_local] <url正则> url script-response-body <本文件>
 *   均需在 [MITM]/[Mitm] 里放行对应 hostname 并信任证书。
 * =============================================================================
 */

'use strict';

// ↓↓↓ 机场专属参数：解密密码（必改）与 QX 专用的 iCloud 落盘文件名（可忽略）
var SUBSCRIPTION_PASSWORD = 'L1QdZCzcPPvNs3cd4KKP'; // SpeedCat/闪电猫 的密码
var ICLOUD_FILE_PATH      = 'speedcat.snippet';

/* ============================ 工具：GF(2^8) / S-Box ========================= */
var gmul = function (a, b) { var p = 0; for (var i = 0; i < 8; i++) { if (b & 1) p ^= a; var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p; };
var AES_SBOX = (function () {
  var inv = new Uint8Array(256);
  for (var i = 1; i < 256; i++) { for (var j = 1; j < 256; j++) { if (gmul(i, j) === 1) { inv[i] = j; break; } } }
  var rot = function (x, n) { return ((x << n) | (x >>> (8 - n))) & 0xff; };
  var s = new Uint8Array(256);
  for (var k = 0; k < 256; k++) { var v = inv[k]; s[k] = (v ^ rot(v, 1) ^ rot(v, 2) ^ rot(v, 3) ^ rot(v, 4) ^ 0x63) & 0xff; }
  return s;
})();

/* ============================ SHA-256 ====================================== */
var SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
function sha256(bytes) {
  var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  var bitLenHi = Math.floor((bytes.length * 8) / 0x100000000), bitLenLo = (bytes.length * 8) >>> 0;
  var total = Math.ceil((bytes.length + 9) / 64) * 64, msg = new Uint8Array(total);
  msg.set(bytes); msg[bytes.length] = 0x80;
  msg[total - 8] = bitLenHi >>> 24; msg[total - 7] = bitLenHi >>> 16; msg[total - 6] = bitLenHi >>> 8; msg[total - 5] = bitLenHi;
  msg[total - 4] = bitLenLo >>> 24; msg[total - 3] = bitLenLo >>> 16; msg[total - 2] = bitLenLo >>> 8; msg[total - 1] = bitLenLo;
  var w = new Uint32Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (var i = 0; i < 16; i++) { var p = off + i * 4; w[i] = ((msg[p] << 24) | (msg[p + 1] << 16) | (msg[p + 2] << 8) | msg[p + 3]) >>> 0; }
    for (var t = 16; t < 64; t++) {
      var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var r = 0; r < 64; r++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + SHA256_K[r] + w[r]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = new Uint8Array(32);
  for (var z = 0; z < 8; z++) { out[z * 4] = H[z] >>> 24; out[z * 4 + 1] = H[z] >>> 16; out[z * 4 + 2] = H[z] >>> 8; out[z * 4 + 3] = H[z]; }
  return out;
}

/* ============================ AES-256 核心 ================================= */
function expandAes256Key(key) {
  if (key.length !== 32) throw new Error('AES-256 key length is invalid');
  var w = new Uint8Array(240); w.set(key);
  var tmp = new Uint8Array(4), i = 32, rcon = 1;
  while (i < w.length) {
    tmp.set(w.subarray(i - 4, i));
    if (i % 32 === 0) {
      var t = tmp[0];
      tmp[0] = AES_SBOX[tmp[1]] ^ rcon; tmp[1] = AES_SBOX[tmp[2]]; tmp[2] = AES_SBOX[tmp[3]]; tmp[3] = AES_SBOX[t];
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
    } else if (i % 32 === 16) {
      for (var k = 0; k < 4; k++) tmp[k] = AES_SBOX[tmp[k]];
    }
    for (var j = 0; j < 4; j++) { w[i] = w[i - 32] ^ tmp[j]; i++; }
  }
  return w;
}
function addRoundKey(s, rk, round) { var o = round * 16; for (var i = 0; i < 16; i++) s[i] ^= rk[o + i]; }
function shiftRows(s) {
  var t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; var t2 = s[6]; s[2] = s[10]; s[6] = s[14]; s[10] = t; s[14] = t2;
  t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
}
function xtime(x) { return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff; }
function mixColumns(s) {
  for (var c = 0; c < 4; c++) {
    var i = c * 4, a = s[i], b = s[i + 1], d = s[i + 2], e = s[i + 3];
    var all = a ^ b ^ d ^ e;
    s[i] ^= all ^ xtime(a ^ b); s[i + 1] ^= all ^ xtime(b ^ d);
    s[i + 2] ^= all ^ xtime(d ^ e); s[i + 3] ^= all ^ xtime(e ^ a);
  }
}
function aesEncryptBlock(block, rk) {
  var s = new Uint8Array(block);
  addRoundKey(s, rk, 0);
  for (var r = 1; r < 14; r++) { for (var i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]]; shiftRows(s); mixColumns(s); addRoundKey(s, rk, r); }
  for (var i2 = 0; i2 < 16; i2++) s[i2] = AES_SBOX[s[i2]];
  shiftRows(s); addRoundKey(s, rk, 14);
  return s;
}

/* ============================ GCM ========================================== */
function toWords(b) { var w = new Uint32Array(4); for (var i = 0; i < 4; i++) { var o = i * 4; w[i] = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; } return w; }
function toBytes(w) { var b = new Uint8Array(16); for (var i = 0; i < 4; i++) { b[i * 4] = w[i] >>> 24; b[i * 4 + 1] = w[i] >>> 16; b[i * 4 + 2] = w[i] >>> 8; b[i * 4 + 3] = w[i]; } return b; }
function gmul2(x, y) {
  var z = new Uint32Array(4), v = new Uint32Array(y);
  for (var i = 0; i < 128; i++) {
    if ((x[i >>> 5] >>> (31 - (i & 31))) & 1) { z[0] ^= v[0]; z[1] ^= v[1]; z[2] ^= v[2]; z[3] ^= v[3]; }
    var lsb = v[3] & 1;
    v[3] = (v[3] >>> 1 | v[2] << 31) >>> 0; v[2] = (v[2] >>> 1 | v[1] << 31) >>> 0; v[1] = (v[1] >>> 1 | v[0] << 31) >>> 0; v[0] = v[0] >>> 1;
    if (lsb) v[0] = (v[0] ^ 0xe1000000) >>> 0;
  }
  return z;
}
function ghash(H, data) {
  var y = new Uint32Array(4), hw = toWords(H);
  for (var off = 0; off < data.length; off += 16) {
    var blk = new Uint8Array(16); blk.set(data.subarray(off, Math.min(off + 16, data.length)));
    var bw = toWords(blk);
    for (var i = 0; i < 4; i++) y[i] ^= bw[i];
    y = gmul2(y, hw);
  }
  var lenBlk = new Uint8Array(16), bits = data.length * 8;
  lenBlk[8] = Math.floor(bits / 0x100000000) >>> 24; lenBlk[9] = Math.floor(bits / 0x100000000) >>> 16;
  lenBlk[10] = Math.floor(bits / 0x100000000) >>> 8;  lenBlk[11] = Math.floor(bits / 0x100000000);
  lenBlk[12] = (bits >>> 24) & 0xff; lenBlk[13] = (bits >>> 16) & 0xff; lenBlk[14] = (bits >>> 8) & 0xff; lenBlk[15] = bits & 0xff;
  var lw = toWords(lenBlk); for (var j = 0; j < 4; j++) y[j] ^= lw[j];
  return toBytes(gmul2(y, hw));
}
function incCounter(c) { for (var i = 15; i >= 12; i--) { c[i] = (c[i] + 1) & 0xff; if (c[i] !== 0) break; } }
function ctEqual(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

function aes256GcmDecrypt(key, nonce, ct, tag) {
  if (nonce.length !== 12) throw new Error('GCM nonce length is invalid');
  if (tag.length !== 16) throw new Error('GCM tag length is invalid');
  var rk = expandAes256Key(key), H = aesEncryptBlock(new Uint8Array(16), rk);
  var J0 = new Uint8Array(16); J0.set(nonce); J0[15] = 1;
  var S = ghash(H, ct);
  var EJ0 = aesEncryptBlock(J0, rk), expected = new Uint8Array(16);
  for (var i = 0; i < 16; i++) expected[i] = EJ0[i] ^ S[i];
  if (!ctEqual(expected, tag)) throw new Error('AES-GCM authentication failed');
  var out = new Uint8Array(ct.length), ctr = new Uint8Array(J0);
  for (var off = 0; off < ct.length; off += 16) {
    incCounter(ctr);
    var ks = aesEncryptBlock(ctr, rk), n = Math.min(16, ct.length - off);
    for (var j = 0; j < n; j++) out[off + j] = ct[off + j] ^ ks[j];
  }
  return out;
}

/* ============================ Base64 ====================================== */
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeBase64(str) {
  var s = String(str).replace(/\s+/g, '');
  if (s.length === 0 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Response body contains invalid Base64 characters');
  var out = [];
  for (var i = 0; i < s.length; i += 4) {
    var c0 = B64.indexOf(s[i]), c1 = B64.indexOf(s[i + 1]);
    var c2 = s[i + 2] === '=' ? -1 : B64.indexOf(s[i + 2]);
    var c3 = s[i + 3] === '=' ? -1 : B64.indexOf(s[i + 3]);
    if (c0 < 0 || c1 < 0 || (c2 < 0 && s[i + 2] !== '=') || (c3 < 0 && s[i + 3] !== '=')) throw new Error('Response body contains invalid Base64 characters');
    var n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out.push((n >>> 16) & 0xff); if (c2 >= 0) out.push((n >>> 8) & 0xff); if (c3 >= 0) out.push(n & 0xff);
  }
  return new Uint8Array(out);
}

/* ============================ 主逻辑 ====================================== */
function utf8Encode(s) { var a = new Uint8Array(s.length * 3), p = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0x80) a[p++] = c; else if (c < 0x800) { a[p++] = 0xc0 | (c >> 6); a[p++] = 0x80 | (c & 0x3f); } else { a[p++] = 0xe0 | (c >> 12); a[p++] = 0x80 | ((c >> 6) & 0x3f); a[p++] = 0x80 | (c & 0x3f); } } return a.subarray(0, p); }
function utf8Decode(bytes) { var s = '', i = 0; while (i < bytes.length) { var c = bytes[i++]; if (c < 0x80) s += String.fromCharCode(c); else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f)); else if (c < 0xf0) s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)); else { var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f); cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); } } return s; }

function decryptMextinSubscription(b64, password) {
  var raw = decodeBase64(b64);
  if (raw.length < 29) throw new Error('Encrypted response is too short');
  var nonce = raw.subarray(0, 12);
  var ct = raw.subarray(12, raw.length - 16);
  var tag = raw.subarray(raw.length - 16);
  return aes256GcmDecrypt(sha256(utf8Encode(password)), nonce, ct, tag);
}

// ---- 平台分发 ----
function log(msg) { if (typeof console !== 'undefined' && console.log) console.log('[mextin-decode] ' + msg); }

function handleBody(bodyStr) {
  if (!bodyStr) { log('响应体为空，原样放行'); return null; }
  var plain = utf8Decode(decryptMextinSubscription(bodyStr, SUBSCRIPTION_PASSWORD));
  log('解密成功，明文 ' + plain.length + ' 字符');
  return plain;
}

if (typeof $response !== 'undefined' && typeof $done === 'function') {
  // Loon / Surge / Quantumult X
  try {
    var body = (typeof $response.body === 'string') ? $response.body
      : (typeof $response.bodyBytes !== 'undefined' ? utf8Decode($response.bodyBytes) : '');
    var plain = handleBody(body);
    if (plain === null) { $done({}); } else { $done({ body: plain }); }
  } catch (e) {
    log('解密失败: ' + String(e));
    $done({});
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sha256: sha256, aes256GcmDecrypt: aes256GcmDecrypt, decodeBase64: decodeBase64, decryptMextinSubscription: decryptMextinSubscription, utf8Encode: utf8Encode, utf8Decode: utf8Decode, SUBSCRIPTION_PASSWORD: SUBSCRIPTION_PASSWORD };
}
