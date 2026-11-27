/* Kite motion — WebM duration patcher.
 *
 * MediaRecorder(webm) writes a *live* stream: the Segment header declares an
 * unknown size and the Info element carries no Duration. Players then show
 * 0:00 (or "Duration: N/A") and refuse to seek, even though every cluster is
 * there. This rewrites the EBML header region — Info gains a real Duration
 * (and the Segment size is corrected when it was declared) — and leaves every
 * cluster byte untouched.
 *
 * No dependency, no re-encode, works on the whole ArrayBuffer in place:
 *   KM_WEBM.fix(blob, { duration: 54600 }).then(function (r) { ... });
 *     r = { blob, patched, seconds, reason }
 */
(function (root) {
  'use strict';

  var ID = {
    EBML: 0x1A45DFA3,
    SEGMENT: 0x18538067,
    SEEKHEAD: 0x114D9B74,
    INFO: 0x1549A966,
    TRACKS: 0x1654AE6B,
    CLUSTER: 0x1F43B675,
    CUES: 0x1C53BB6B,
    TIMECODE: 0xE7,
    SIMPLEBLOCK: 0xA3,
    BLOCKGROUP: 0xA0,
    BLOCK: 0xA1,
    DURATION: 0x4489,
    TIMECODESCALE: 0x2AD7B1,
    VOID: 0xEC
  };

  /* ---------------- EBML primitives ---------------- */

  function readVint(u8, p, keep) {
    if (p < 0 || p >= u8.length) return null;
    var first = u8[p];
    if (first === 0) return null;
    var mask = 0x80, len = 1;
    while (!(first & mask)) { mask >>= 1; len++; if (len > 8) return null; }
    if (p + len > u8.length) return null;
    var value = keep ? first : (first & (mask - 1));
    var allOnes = keep ? false : ((first & (mask - 1)) === (mask - 1));
    for (var i = 1; i < len; i++) {
      var b = u8[p + i];
      value = value * 256 + b;
      if (b !== 0xFF) allOnes = false;
    }
    return { value: value, len: len, allOnes: allOnes };
  }

  function parseHeader(u8, p, limit) {
    if (limit === undefined || limit > u8.length) limit = u8.length;
    var id = readVint(u8, p, true);
    if (!id) return null;
    var sz = readVint(u8, p + id.len, false);
    if (!sz) return null;
    var bodyStart = p + id.len + sz.len;
    var unknown = sz.allOnes;
    var size = unknown ? Math.max(0, limit - bodyStart) : sz.value;
    return {
      id: id.value, idLen: id.len, size: size, sizeLen: sz.len, unknown: unknown,
      start: p, hdrLen: id.len + sz.len, bodyStart: bodyStart,
      end: Math.min(limit, bodyStart + size)
    };
  }

  function readUint(u8, p, len) {
    var v = 0;
    for (var i = 0; i < len; i++) {
      v = v * 256 + u8[p + i];
      if (v > 9007199254740991) return v;
    }
    return v;
  }

  /* minimal-length big-endian vint for a size field */
  function sizeBytes(n) {
    var len = 1;
    while (len < 8 && n >= Math.pow(2, 7 * len) - 1) len++;
    var out = new Uint8Array(len);
    var v = n;
    for (var i = len - 1; i > 0; i--) { out[i] = v & 0xFF; v = Math.floor(v / 256); }
    out[0] = v | (0x80 >> (len - 1));
    return out;
  }

  function elem(id, body) {
    // id is written as its own EBML id bytes
    var idBytes = [];
    var v = id;
    while (v > 0) { idBytes.unshift(v & 0xFF); v = Math.floor(v / 256); }
    var sz = sizeBytes(body.length);
    var out = new Uint8Array(idBytes.length + sz.length + body.length);
    out.set(idBytes, 0);
    out.set(sz, idBytes.length);
    out.set(body, idBytes.length + sz.length);
    return out;
  }

  function durationElem(units) {
    var body = new Uint8Array(8);
    new DataView(body.buffer).setFloat64(0, units, false);
    return elem(ID.DURATION, body);
  }

  /* ---------------- structure ---------------- */

  function readInfo(u8, info) {
    var q = info.bodyStart, scale = 1000000, durAt = -1, durLen = 0;
    while (q < info.end) {
      var c = parseHeader(u8, q, info.end);
      if (!c || c.end <= q) break;
      if (c.id === ID.TIMECODESCALE) {
        var s = readUint(u8, c.bodyStart, c.size);
        if (s > 0) scale = s;
      } else if (c.id === ID.DURATION) {
        durAt = c.bodyStart; durLen = c.size;
      }
      q = c.end;
    }
    return { scale: scale, durAt: durAt, durLen: durLen };
  }

  /* last block timestamp, in TimecodeScale units */
  function scanMaxTimestamp(u8, from) {
    var p = from, tc = 0, max = 0, maxTc = 0, guard = 0;
    while (p < u8.length && guard++ < 4000000) {
      var e = parseHeader(u8, p);
      if (!e) break;
      if (e.id === ID.CLUSTER) {
        var c = parseHeader(u8, e.bodyStart, e.end);
        if (c && c.id === ID.TIMECODE) {
          tc = readUint(u8, c.bodyStart, c.size);
          if (tc > maxTc) maxTc = tc;
        }
        p = e.bodyStart; /* walk the children flat, cluster sizes may be unknown */
        continue;
      }
      if (e.id === ID.SIMPLEBLOCK || e.id === ID.BLOCK) {
        /* [track number vint][int16 relative timecode][flags][data] */
        var tv = readVint(u8, e.bodyStart, true);
        var off = e.bodyStart + (tv ? tv.len : 1);
        if (off + 1 < u8.length) {
          var rel = u8[off] * 256 + u8[off + 1];
          if (rel > 32767) rel -= 65536;
          if (tc + rel > max) max = tc + rel;
        }
      }
      if (e.unknown) break;
      if (e.end <= p) break;
      p = e.end;
    }
    return Math.max(max, maxTc);
  }

  function scanFirstCluster(u8, seg) {
    var p = seg.bodyStart, guard = 0;
    while (p < u8.length && guard++ < 100000) {
      var e = parseHeader(u8, p);
      if (!e) return -1;
      if (e.id === ID.CLUSTER) return p;
      if (e.unknown) return -1;
      if (e.end <= p) return -1;
      p = e.end;
    }
    return -1;
  }

  /* ---------------- patch ---------------- */

  function patch(u8, opts) {
    var ebml = parseHeader(u8, 0);
    if (!ebml || ebml.id !== ID.EBML) return { ok: false, reason: 'no-ebml-header' };
    var seg = parseHeader(u8, ebml.end);
    if (!seg || seg.id !== ID.SEGMENT) return { ok: false, reason: 'no-segment' };

    /* Info is written by the muxer before Tracks / Clusters */
    var p = seg.bodyStart, info = null, guard = 0;
    while (p < u8.length && guard++ < 64) {
      var e = parseHeader(u8, p);
      if (!e) break;
      if (e.id === ID.INFO) { info = e; break; }
      if (e.id === ID.CLUSTER || e.unknown) break;
      if (e.end <= p) break;
      p = e.end;
    }
    if (!info) return { ok: false, reason: 'no-info' };

    var meta = readInfo(u8, info);

    /* duration in TimecodeScale units */
    var units = 0, source = '';
    var firstCluster = scanFirstCluster(u8, seg);
    if (firstCluster >= 0) {
      var lastTs = scanMaxTimestamp(u8, firstCluster);
      if (lastTs > 0) {
        units = lastTs + Math.round(33 * 1000000 / meta.scale); /* + one frame */
        source = 'clusters';
      }
    }
    var elapsedUnits = (opts && opts.duration > 0) ? opts.duration * 1000000 / meta.scale : 0;
    /* The blocks are the truth; the wall clock only wins when the two disagree
       by more than 2s (a throttled tab drops frames and stops writing blocks). */
    if (!units) { units = elapsedUnits; source = 'clock'; }
    else if (elapsedUnits && Math.abs(elapsedUnits - units) > 2000 * 1000000 / meta.scale) {
      units = elapsedUnits; source = 'clock';
    }
    if (!units) return { ok: false, reason: 'no-duration' };
    /* never report more than the media plus a frame, never less than 1ms */
    units = Math.max(1, Math.round(units));

    /* 1) Duration already present and the same width → overwrite in place */
    if (meta.durAt >= 0 && meta.durLen === 8) {
      new DataView(u8.buffer, u8.byteOffset + meta.durAt, 8).setFloat64(0, units, false);
      return { ok: true, parts: null, units: units, source: source, scale: meta.scale };
    }

    /* 2) append a Duration child to Info (Info is varint-sized, so it grows by 11) */
    var bodyLen = info.end - info.bodyStart;
    var body = u8.slice(info.bodyStart, info.end);
    var newInfo = elem(ID.INFO, concat(body, durationElem(units)));
    var delta = newInfo.length - (info.end - info.start);

    var parts = [];
    if (seg.unknown) {
      parts.push(u8.subarray(0, seg.bodyStart));
    } else {
      var szb = sizeBytes(seg.size + delta);
      if (szb.length !== seg.sizeLen) {
        if (seg.sizeLen === 8) { szb = new Uint8Array([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]); }
        else return { ok: false, reason: 'segment-size-width' };
      }
      parts.push(u8.subarray(0, seg.start));
      var idb = u8.subarray(seg.start, seg.start + seg.idLen);
      parts.push(idb);
      parts.push(szb);
      parts.push(u8.subarray(seg.start + seg.idLen + seg.sizeLen, seg.bodyStart));
    }
    parts.push(u8.subarray(seg.bodyStart, info.start));
    parts.push(newInfo);
    parts.push(u8.subarray(info.end));
    return { ok: true, parts: parts, units: units, source: source, scale: meta.scale };
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }

  /* ---------------- public ---------------- */

  function fix(blob, opts) {
    opts = opts || {};
    if (!blob) return Promise.resolve({ blob: blob, patched: false, reason: 'no-blob' });
    if (!/webm/i.test(blob.type || '') && !/webm/i.test(opts.name || '')) {
      return Promise.resolve({ blob: blob, patched: false, reason: 'not-webm' });
    }
    if (typeof blob.arrayBuffer !== 'function') {
      return Promise.resolve({ blob: blob, patched: false, reason: 'no-arraybuffer' });
    }
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      var res = patch(u8, opts);
      if (!res.ok) return { blob: blob, patched: false, reason: res.reason };
      if (!res.parts) return { blob: blob, patched: true, seconds: res.units * (res.scale || 1000000) / 1e9, source: res.source, inPlace: true };
      var out = new Blob(res.parts, { type: blob.type || 'video/webm' });
      return {
        blob: out, patched: true, seconds: res.units * (res.scale || 1000000) / 1e9,
        source: res.source, inPlace: false
      };
    }).catch(function (err) {
      return { blob: blob, patched: false, reason: 'error:' + (err && err.message) };
    });
  }

  /* read back the Duration of a finished file (verification / tests) */
  function durationOf(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      var ebml = parseHeader(u8, 0);
      if (!ebml) return null;
      var seg = parseHeader(u8, ebml.end);
      if (!seg) return null;
      var p = seg.bodyStart;
      for (var i = 0; i < 64 && p < u8.length; i++) {
        var e = parseHeader(u8, p);
        if (!e) return null;
        if (e.id === ID.INFO) {
          var q = e.bodyStart;
          while (q < e.end) {
            var c = parseHeader(u8, q, e.end);
            if (!c) return null;
            if (c.id === ID.DURATION && c.size === 8) {
              var dv = new DataView(u8.buffer, u8.byteOffset + c.bodyStart, 8);
              return dv.getFloat64(0, false);
            }
            q = c.end;
          }
          return null;
        }
        if (e.unknown) return null;
        p = e.end;
      }
      return null;
    });
  }

  var api = { fix: fix, durationOf: durationOf, _patch: patch, _parseHeader: parseHeader,
    _scanMax: scanMaxTimestamp, _firstCluster: scanFirstCluster, _readInfo: readInfo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KM_WEBM = api;
})(typeof window !== 'undefined' ? window : this);
