/* ============================================================
   Creamy Browser for Windows — Lemon Pass 금고 암호화 (pass-vault.js)
   ------------------------------------------------------------
   pass.html 과 100% 같은 형식을 쓴다. 한쪽에서 만든 금고를 다른 쪽에서
   그대로 열 수 있어야 하므로 아래 값을 바꾸지 않는다.

     · 키 유도 : PBKDF2-SHA256, 250,000회, salt 16바이트
     · 암호화  : AES-256-GCM, iv 12바이트 (저장할 때마다 새로 만든다)
     · 평문    : {"v":1,"items":[{id,type,site,url,user,pass,env,memo,ts,upd}, ...]}
     · 저장값  : {v:1, salt:b64, iter, iv:b64, ct:b64, hint, created, updated, count}

   마스터 비밀번호와 평문은 이 모듈 밖으로 나가지 않는다.
   ============================================================ */
(function () {
  'use strict';

  var ITER = 250000;

  function subtleOK() {
    return !!(typeof crypto !== 'undefined' && crypto && crypto.subtle && crypto.getRandomValues);
  }

  function b64(buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function unb64(str) {
    var bin = atob(String(str || ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function enc(str) { return new TextEncoder().encode(str); }
  function dec(buf) { return new TextDecoder().decode(buf); }

  function deriveKey(password, salt, iter) {
    var rounds = Number(iter) > 0 ? Number(iter) : ITER;
    return crypto.subtle.importKey('raw', enc(String(password)), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: rounds, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    });
  }

  function parse(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
      var v = JSON.parse(String(raw));
      return (v && typeof v === 'object') ? v : null;
    } catch (e) {
      return null;
    }
  }

  function itemCount(meta) {
    var m = parse(meta);
    return m ? (Number(m.count) || 0) : 0;
  }

  function updatedAt(meta) {
    var m = parse(meta);
    if (!m) return 0;
    return Number(m.updated) || Number(m.created) || 0;
  }

  /* 새 금고 : meta 와 열린 키를 돌려준다. */
  function create(password, hint) {
    if (!subtleOK()) return Promise.reject(new Error('no-webcrypto'));
    var pw = String(password || '');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return deriveKey(pw, salt, ITER).then(function (key) {
      var meta = {
        v: 1,
        salt: b64(salt),
        iter: ITER,
        hint: String(hint || '').trim(),
        created: Date.now(),
        count: 0
      };
      return seal(key, meta, []).then(function (next) {
        return { key: key, meta: next, items: [] };
      });
    });
  }

  /* 잠금 해제 : 비밀번호가 틀리면 reject. */
  function unlock(password, metaRaw) {
    if (!subtleOK()) return Promise.reject(new Error('no-webcrypto'));
    var meta = parse(metaRaw);
    if (!meta || !meta.salt || !meta.ct || !meta.iv) return Promise.reject(new Error('invalid-vault'));
    var derived = null;
    return deriveKey(String(password || ''), unb64(meta.salt), meta.iter || ITER).then(function (key) {
      derived = key;
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(meta.iv) }, key, unb64(meta.ct));
    }).then(function (plain) {
      var data = null;
      try { data = JSON.parse(dec(plain)); } catch (e) { data = null; }
      if (!data || typeof data !== 'object') throw new Error('invalid-plain');
      return { key: derived, meta: meta, items: Array.isArray(data.items) ? data.items : [] };
    });
  }

  /* 다시 저장 : 새 iv 로 암호문을 만들고 meta 를 갱신한다. */
  function seal(key, metaRaw, items) {
    if (!subtleOK()) return Promise.reject(new Error('no-webcrypto'));
    var meta = parse(metaRaw);
    if (!meta || !meta.salt) return Promise.reject(new Error('invalid-vault'));
    var list = Array.isArray(items) ? items : [];
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key, enc(JSON.stringify({ v: 1, items: list }))
    ).then(function (ct) {
      var next = {};
      Object.keys(meta).forEach(function (k) { next[k] = meta[k]; });
      next.v = 1;
      next.iter = Number(next.iter) || ITER;
      next.iv = b64(iv);
      next.ct = b64(ct);
      next.updated = Date.now();
      next.count = list.length;
      return next;
    });
  }

  function itemId() {
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /* 사이트 주소 비교 : www. 제거, 대소문자 무시, 하위 도메인 허용. */
  function hostOf(url) {
    var s = String(url || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      return new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function hostMatches(itemUrl, pageHost) {
    var h = hostOf(itemUrl);
    var p = String(pageHost || '').toLowerCase().replace(/^www\./, '');
    if (!h || !p) return false;
    if (h === p) return true;
    return p.length > h.length && p.slice(-(h.length + 1)) === '.' + h;
  }

  window.CreamyPassVault = {
    ITER: ITER,
    subtleOK: subtleOK,
    b64: b64,
    unb64: unb64,
    deriveKey: deriveKey,
    parse: parse,
    create: create,
    unlock: unlock,
    seal: seal,
    itemId: itemId,
    itemCount: itemCount,
    updatedAt: updatedAt,
    hostOf: hostOf,
    hostMatches: hostMatches
  };
})();
