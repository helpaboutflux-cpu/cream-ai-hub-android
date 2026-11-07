const https = require('https');

const cache = new Map();

function gtxRequest(text, target) {
  return new Promise(function (resolve, reject) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': '*/*'
      }
    }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body = body + c; });
      res.on('end', function () {
        try {
          const data = JSON.parse(body);
          if (!Array.isArray(data) || !Array.isArray(data[0])) {
            reject(new Error('unexpected response'));
            return;
          }
          let out = '';
          data[0].forEach(function (seg) {
            if (seg && typeof seg[0] === 'string') out = out + seg[0];
          });
          resolve(out);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
  });
}

async function translateTexts(texts, target) {
  const results = new Array(texts.length);
  const unique = new Map();
  texts.forEach(function (text, index) {
    if (!unique.has(text)) unique.set(text, []);
    unique.get(text).push(index);
  });

  const pending = [];
  unique.forEach(function (indexList, text) {
    pending.push({ text: text, indexList: indexList });
  });

  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < pending.length) {
      const job = pending[cursor];
      cursor = cursor + 1;
      let translated = null;
      if (cache.has(target + ':' + job.text)) {
        translated = cache.get(target + ':' + job.text);
      } else {
        try {
          translated = await gtxRequest(job.text, target);
          if (cache.size < 5000) cache.set(target + ':' + job.text, translated);
        } catch (err) {
          translated = null;
        }
      }
      if (translated === null) translated = job.text;
      job.indexList.forEach(function (i) { results[i] = translated; });
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

module.exports = { translateTexts: translateTexts };
