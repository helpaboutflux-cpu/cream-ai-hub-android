/* ============================================================
   Creamy Browser for Windows — 동기화 병합 규칙 (sync-merge.js)
   ------------------------------------------------------------
   네트워크·파일 입출력이 없는 순수 함수만 둔다.
   main.js(sync.js)와 테스트가 같은 규칙을 쓴다.

   · 북마크  : URL 기준 합집합. 같은 URL 이면 더 최근 항목의 제목·폴더를 쓴다.
   · 방문기록: URL 기준 합집합. 같은 URL 이면 더 최근 방문 시각을 남기고 500개로 자른다.
   · 금고    : lemon_pass_vault 의 meta.updated 가 더 큰 쪽을 쓴다.
               (암호문은 절대 복호화하지 않고 그대로 옮긴다)
   ============================================================ */
'use strict';

var HISTORY_CAP = 500;

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function urlKey(url) {
  return String(url === null || url === undefined ? '' : url).trim().replace(/\/+$/, '');
}

function bookmarkTime(b) {
  return num(b && (b.ts || b.time || b.id));
}

function historyTime(h) {
  return num(h && (h.time || h.ts || h.id));
}

/* 북마크: 로컬 순서를 유지하고, 원격에만 있는 항목을 뒤에 붙인다. */
function mergeBookmarks(local, remote) {
  var localList = Array.isArray(local) ? local : [];
  var remoteList = Array.isArray(remote) ? remote : [];
  var remoteMap = {};
  remoteList.forEach(function (b) {
    var k = urlKey(b && b.url);
    if (!k) return;
    var prev = remoteMap[k];
    if (!prev || bookmarkTime(b) > bookmarkTime(prev)) remoteMap[k] = b;
  });

  var out = [];
  var seen = {};
  var pulled = 0;
  localList.forEach(function (b) {
    var k = urlKey(b && b.url);
    if (!k || seen[k]) return;
    seen[k] = 1;
    var r = remoteMap[k];
    if (r && bookmarkTime(r) > bookmarkTime(b)) {
      out.push({ id: b.id || r.id, title: r.title || b.title, url: b.url, folder: r.folder || b.folder || '기본', ts: bookmarkTime(r) });
      pulled = pulled + 1;
    } else {
      out.push(b);
    }
  });

  var extra = [];
  remoteList.forEach(function (b) {
    var k = urlKey(b && b.url);
    if (!k || seen[k]) return;
    seen[k] = 1;
    extra.push(b);
    pulled = pulled + 1;
  });
  extra.sort(function (a, b) { return bookmarkTime(b) - bookmarkTime(a); });

  return { list: out.concat(extra), pulled: pulled };
}

/* 방문기록: 최신 순으로 정렬하고 상한을 넘는 오래된 항목은 버린다. */
function mergeHistory(local, remote, cap) {
  var limit = num(cap) > 0 ? num(cap) : HISTORY_CAP;
  var localList = Array.isArray(local) ? local : [];
  var remoteList = Array.isArray(remote) ? remote : [];
  var map = {};
  var order = [];
  function add(h) {
    var k = urlKey(h && h.url);
    if (!k) return;
    if (!map[k]) {
      map[k] = { url: String(h.url), title: h.title || String(h.url), time: historyTime(h) };
      order.push(k);
      return;
    }
    var t = historyTime(h);
    if (t > map[k].time) {
      map[k].time = t;
      map[k].title = h.title || map[k].title;
    }
  }
  localList.forEach(add);
  remoteList.forEach(add);

  var list = order.map(function (k) { return map[k]; });
  list.sort(function (a, b) { return b.time - a.time; });
  var localCount = localList.length;
  var out = list.slice(0, limit);
  var pulled = 0;
  out.forEach(function (h) {
    if (!localList.some(function (x) { return urlKey(x && x.url) === urlKey(h.url); })) pulled = pulled + 1;
  });
  var merged = out.length !== localCount || pulled > 0;
  return { list: out, pulled: pulled, changed: merged };
}

/* ---------------- Lemon Pass 금고 ---------------- */

/* 저장값은 JSON 문자열(브라우저 localStorage) 또는 이미 파싱된 객체(snapshot.keys) 둘 다 받는다. */
function parseVault(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') {
    return (raw && typeof raw.salt === 'string' && typeof raw.ct === 'string') ? raw : null;
  }
  try {
    var v = JSON.parse(String(raw));
    return (v && typeof v.salt === 'string' && typeof v.ct === 'string') ? v : null;
  } catch (e) {
    return null;
  }
}

function vaultUpdatedAt(raw) {
  var v = parseVault(raw);
  if (!v) return 0;
  return num(v.updated) || num(v.created) || 0;
}

function vaultCount(raw) {
  var v = parseVault(raw);
  return v ? num(v.count) : 0;
}

function sameVault(a, b) {
  var x = parseVault(a);
  var y = parseVault(b);
  if (!x || !y) return !x && !y;
  return x.ct === y.ct && x.iv === y.iv && x.salt === y.salt;
}

/* 어느 쪽 금고를 쓸지 정한다.
   action: 'empty'(둘 다 없음) · 'same' · 'push'(로컬이 더 최신) · 'pull'(원격이 더 최신) */
function decideVault(localRaw, remoteRaw) {
  var local = parseVault(localRaw);
  var remote = parseVault(remoteRaw);
  if (!local && !remote) return { action: 'empty', vault: null, updatedAt: 0 };
  if (local && !remote) return { action: 'push', vault: local, updatedAt: vaultUpdatedAt(local) };
  if (!local && remote) return { action: 'pull', vault: remote, updatedAt: vaultUpdatedAt(remote) };
  if (sameVault(local, remote)) return { action: 'same', vault: local, updatedAt: vaultUpdatedAt(local) };
  var lu = vaultUpdatedAt(local);
  var ru = vaultUpdatedAt(remote);
  if (lu >= ru) return { action: 'push', vault: local, updatedAt: lu };
  return { action: 'pull', vault: remote, updatedAt: ru };
}

/* Snapshot 의 다른 키(설정·작업물 메타)는 그대로 두고 금고 키만 바꾼다. */
function withVault(snap, vault) {
  var out = {};
  if (snap && typeof snap === 'object') {
    Object.keys(snap).forEach(function (k) { out[k] = snap[k]; });
  }
  if (!out.app) out.app = 'soft-hub';
  if (!out.schema) out.schema = 2;
  if (!out.keys || typeof out.keys !== 'object') out.keys = {};
  out.keys = {};
  if (snap && snap.keys && typeof snap.keys === 'object') {
    Object.keys(snap.keys).forEach(function (k) { out.keys[k] = snap.keys[k]; });
  }
  if (vault) out.keys.lemon_pass_vault = vault;
  else delete out.keys.lemon_pass_vault;
  out.updatedAt = Date.now();
  if (!out.createdAt) out.createdAt = out.updatedAt;
  return out;
}

module.exports = {
  HISTORY_CAP: HISTORY_CAP,
  urlKey: urlKey,
  mergeBookmarks: mergeBookmarks,
  mergeHistory: mergeHistory,
  parseVault: parseVault,
  vaultUpdatedAt: vaultUpdatedAt,
  vaultCount: vaultCount,
  sameVault: sameVault,
  decideVault: decideVault,
  withVault: withVault
};
