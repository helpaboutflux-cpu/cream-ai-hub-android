const AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'partner.googleadservices.com',
  'an.yandex.ru',
  'mc.yandex.ru',
  'ad.10010.com',
  'adcolony.com',
  'adform.net',
  'adnxs.com',
  'adroll.com',
  'adsrvr.org',
  'adsserver.com',
  'adtelligent.com',
  'adyoulike.com',
  'amazon-adsystem.com',
  'amplitude.com',
  'appsflyer.com',
  'applovin.com',
  'ask.com',
  'bidswitch.net',
  'bing.com/bat.js',
  'bluekai.com',
  'branch.io',
  'brealtime.com',
  'buysellads.com',
  'casalemedia.com',
  'chartbeat.com',
  'clickadu.com',
  'clickky.biz',
  'criteo.com',
  'demdex.net',
  'demandbase.com',
  'dotomi.com',
  'doubleverify.com',
  'eagleeyecare.com',
  'egain.net',
  'ensighten.com',
  'exelator.com',
  'facebook.net/fbevents.js',
  'fastly-insights.com',
  'fetchback.com',
  'gigya.com',
  'gumgum.com',
  'hitbox.tv',
  'hotjar.com',
  'improvedigital.com',
  'indexww.com',
  'inmobi.com',
  'inspectlet.com',
  'intentiq.com',
  'ipyx.com',
  'jirafe.com',
  'kochava.com',
  'krxd.net',
  'leadback.com',
  'luckyorange.com',
  'mathtag.com',
  'media.net',
  'mediaforge.com',
  'mixpanel.com',
  'moatads.com',
  'moatpixel.com',
  'mopub.com',
  'netshelter.net',
  'newrelic.com',
  'openx.net',
  'optimizely.com',
  'outbrain.com',
  'pardot.com',
  'pippio.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'pubmatic.com',
  'pubnub.com',
  'quantserve.com',
  'quantcount.com',
  'quora.com/qpixel',
  'revcontent.com',
  'revenuewire.net',
  'rfihub.com',
  'rooking.media',
  'rubiconproject.com',
  'scorecardresearch.com',
  'segment.io',
  'sharethrough.com',
  'sharethis.com',
  'sitescout.com',
  'smartadserver.com',
  'smartclip.com',
  'snigelweb.com',
  'sovrn.com',
  'spotxchange.com',
  'spotx.tv',
  'taboola.com',
  'teads.tv',
  'telaria.com',
  'tidal-tv.com',
  'track.adform.net',
  'trafficjunky.com',
  'tribalfusion.com',
  'turn.com',
  'twitter.com/i/adsct',
  'unityads.unity3d.com',
  'unrulymedia.com',
  'usabilla.com',
  'verizonmedia.com',
  'visualrevenue.com',
  'voicefive.com',
  'w55c.net',
  'yieldlab.net',
  'yieldmo.com',
  'yieldnexus.pw',
  'zeotap.com',
  'zemanta.com',
  'adblockanalytics.com',
  'ads-twitter.com',
  'analytics.tiktok.com',
  'analytics.twitter.com',
  'bat.bing.com',
  'cdn.onesignal.com',
  'clarity.ms',
  'connect.facebook.net',
  'events.redditmedia.com',
  'onesignal.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',
  'static.hotjar.com',
  'surveys.hotjar.com',
  'cdn.mxpnl.com',
  'sc-static.net',
  'tr.snapchat.com',
  'ads.pinterest.com',
  'ct.pinterest.com',
  'log.pinterest.com'
].filter(function (d) { return d && d.length > 3; });

function hostnameMatches(hostname, domain) {
  if (domain.indexOf('/') !== -1) {
    return hostname === domain.split('/')[0];
  }
  return hostname === domain || hostname.slice(-1 * (domain.length + 1)) === '.' + domain;
}

function setupAdblock(targetSession) {
  targetSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, function (details, callback) {
    let blocked = false;
    try {
      const url = details.url;
      if (url.indexOf('http') === 0) {
        const hostname = new URL(url).hostname;
        for (let i = 0; i < AD_DOMAINS.length; i++) {
          if (hostnameMatches(hostname, AD_DOMAINS[i])) {
            blocked = true;
            break;
          }
        }
        if (!blocked && hostname.indexOf('ad.') === 0) blocked = true;
        if (!blocked && hostname.indexOf('ads.') === 0) blocked = true;
        if (!blocked && hostname.indexOf('adservice.') === 0) blocked = true;
        if (!blocked && hostname.indexOf('tracker') !== -1) blocked = true;
        if (!blocked && hostname.indexOf('analytics-') === 0) blocked = true;
      }
    } catch (err) { /* malformed url */ }
    callback({ cancel: blocked });
  });
}

module.exports = { setupAdblock: setupAdblock, AD_DOMAINS: AD_DOMAINS };
