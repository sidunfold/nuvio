/* Nuvio provider. No Node APIs, browser DOM, eval, or bundled credentials. */
'use strict';

var DEFAULT_BASE = 'https://pencurimoviesubmalay26.site';
var USER_AGENT = 'Mozilla/5.0';

function settings() {
  return typeof globalThis !== 'undefined' ? (globalThis.SCRAPER_SETTINGS || {}) : {};
}

function baseUrl() {
  var value = String(settings().baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)) throw new Error('Base URL mesti HTTPS tanpa laluan.');
  return value;
}

function decodeHtml(value) {
  return String(value || '').replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) {
    var code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 65535 ? String.fromCharCode(code) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, function (_, n) {
    return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}[n];
  });
}

function attr(tag, name) {
  var m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'));
  return m ? decodeHtml(m[2]) : '';
}

function plain(value) { return decodeHtml(value).replace(/<[^>]*>/g, '').trim(); }

function normalize(value) {
  value = plain(value).replace(/\(\d{4}\)/g, '').replace(/[\u200e\u200f\u00a0]/g, ' ');
  if (value.normalize) value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return value.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim();
}

function safeUrl(value, parent) {
  value = decodeHtml(value).replace(/\\\//g, '/').trim();
  if (value.indexOf('//') === 0) value = 'https:' + value;
  if (value[0] === '/') value = (parent.match(/^https?:\/\/[^/]+/i) || [''])[0] + value;
  return /^https?:\/\/[^\s<>"']+$/i.test(value) && !/https?:\/\/[^/]*@/i.test(value) ? value : '';
}

function request(url, options) {
  options = options || {};
  var init = {method: options.method || 'GET', headers: {'User-Agent': USER_AGENT}};
  var key;
  for (key in (options.headers || {})) init.headers[key] = options.headers[key];
  if (options.body) init.body = options.body;
  // Some Nuvio runtimes have no timers/AbortController; native fetch has its own timeout.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(12000);
  return fetch(url, init).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' dari ' + url.split('/')[2]);
    return r.text().then(function (text) {
      if (text.length > 3000000) throw new Error('Respons terlalu besar.');
      return text;
    });
  });
}

function metadata(id, type) {
  id = String(id).replace(/^tmdb:/, '');
  if (!/^\d+$/.test(id)) return Promise.reject(new Error('TMDB ID tidak sah.'));
  var apiKey = settings().tmdbApiKey || (typeof TMDB_API_KEY !== 'undefined' ? TMDB_API_KEY : '');
  if (!apiKey) return Promise.reject(new Error('Tetapkan TMDB API key dalam tetapan provider.'));
  return request('https://api.themoviedb.org/3/' + type + '/' + id + '?api_key=' + encodeURIComponent(apiKey) + '&language=en-US')
    .then(function (s) {
      var m = JSON.parse(s);
      return {title: m.title || m.name, originalTitle: m.original_title || m.original_name, year: (m.release_date || m.first_air_date || '').slice(0, 4)};
    });
}

function searchEntries(html, meta, type, base) {
  var result = [], seen = {}, tags = html.match(/<a\b[^>]*>/gi) || [];
  tags.forEach(function (tag) {
    var url = safeUrl(attr(tag, 'href'), base), title = attr(tag, 'title');
    var path = type === 'movie' ? '/movies/' : '/tvshows/';
    if (url.indexOf(base + path) !== 0 || !title || seen[url]) return;
    var titleMatch = normalize(title) === normalize(meta.title) || (meta.originalTitle && normalize(title) === normalize(meta.originalTitle));
    var year = (title.match(/\((\d{4})\)/) || [])[1];
    if (!titleMatch || (meta.year && year && String(meta.year) !== year)) return;
    seen[url] = true;
    result.push({url: url, title: plain(title)});
  });
  return result.slice(0, 2);
}

function playerOptions(html) {
  var rows = html.match(/<li\b[^>]*class=["'][^"']*zetaflix_player_option[^"']*["'][^>]*>[\s\S]*?<\/li>/gi) || [];
  return rows.map(function (row) {
    var tag = row.slice(0, row.indexOf('>') + 1);
    var host = (row.match(/class=["']opt-titl["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '';
    var label = (row.match(/class=["']opt-name["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '';
    return {post: attr(tag, 'data-post'), type: attr(tag, 'data-type'), nume: attr(tag, 'data-nume'), host: plain(host), label: plain(label)};
  }).filter(function (o) { return /^\d+$/.test(o.post) && /^\d+$/.test(o.nume) && /^(mv|ep)$/.test(o.type); });
}

function episodeUrl(html, season, episode, base) {
  var tags = html.match(/<a\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    var url = safeUrl(attr(tags[i], 'href'), base);
    if (url.indexOf(base + '/episodes/') !== 0) continue;
    var m = url.match(/-s(\d+)-ep?(\d+)\/?(?:\?.*)?$/i);
    if (m && Number(m[1]) === Number(season) && Number(m[2]) === Number(episode)) return url;
  }
  return '';
}

// Decode Dean Edwards' string substitution format without executing remote scripts.
function unpack(html) {
  var pattern = /}\(\s*'((?:\\.|[^'\\])*)',\s*(\d+),\s*(\d+),\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/g;
  var parts = [], m;
  while ((m = pattern.exec(html)) !== null) {
    var radix = Number(m[2]), count = Number(m[3]);
    if (radix < 2 || radix > 36 || count > 10000) continue;
    var dict = m[4].split('|');
    var body = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
    parts.push(body.replace(/\b\w+\b/g, function (token) {
      var n = parseInt(token, radix);
      return !isNaN(n) && n < count && n.toString(radix) === token && dict[n] ? dict[n] : token;
    }));
  }
  return html + '\n' + parts.join('\n');
}

function directLinks(html, pageUrl) {
  html = unpack(html);
  var links = [], seen = {};
  function add(value) {
    var url = safeUrl(value, pageUrl);
    if (!url || !/\.(?:mp4|m3u8|mkv)(?:[?#]|$)/i.test(url) || seen[url]) return;
    seen[url] = true;
    links.push(url);
  }
  // MixDrop's wurl is the video; vfile and poster are never playback URLs.
  var m, re = /(?:MDCore\.wurl|\bfile|\bsource|\bsrc)\s*[:=]\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html)) !== null) add(m[1]);
  (html.match(/<(?:source|video)\b[^>]*>/gi) || []).forEach(function (tag) { add(attr(tag, 'src')); });
  return links.slice(0, 8);
}

function resolveEmbed(value, referer, depth) {
  var direct = safeUrl(value, referer);
  if (!direct) {
    var iframe = (String(value).match(/<iframe\b[^>]*>/i) || [])[0];
    direct = iframe ? safeUrl(attr(iframe, 'src'), referer) : '';
  }
  if (!direct) return Promise.resolve([]);
  if (/\.(?:mp4|m3u8|mkv)(?:[?#]|$)/i.test(direct)) return Promise.resolve([{url: direct, referer: referer}]);
  if (depth >= 2) return Promise.resolve([]);
  return request(direct, {headers: {Referer: referer}}).then(function (html) {
    var urls = directLinks(html, direct);
    if (urls.length) return urls.map(function (url) { return {url: url, referer: direct}; });
    var iframe = (html.match(/<iframe\b[^>]*>/i) || [])[0];
    return iframe ? resolveEmbed(attr(iframe, 'src'), direct, depth + 1) : [];
  });
}

function collectPage(url, html, base) {
  var options = playerOptions(html);
  // Prefer the supported host and cap concurrent requests to stay within the app's budget.
  options.sort(function (a, b) { return Number(!/^mixdr(?:op)?$/i.test(a.host)) - Number(!/^mixdr(?:op)?$/i.test(b.host)); });
  options = options.slice(0, 8);
  var found = [], start = Date.now();
  function batch(index) {
    // Return a working result before slow fallback hosts can exhaust Nuvio's deadline.
    if (found.length || index >= options.length || Date.now() - start > 35000) return Promise.resolve(found);
    var batchSize = index === 0 && /^mixdr(?:op)?$/i.test(options[0].host) ? 1 : 3;
    return Promise.all(options.slice(index, index + batchSize).map(function (o) {
      var body = 'action=zeta_player_ajax&post=' + encodeURIComponent(o.post) + '&type=' + encodeURIComponent(o.type) + '&nume=' + encodeURIComponent(o.nume);
      return request(base + '/wp-admin/admin-ajax.php', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Referer: url}, body: body})
        .then(function (s) { var data = JSON.parse(s); return resolveEmbed(data.embed_url || '', url, 0); })
        .then(function (streams) {
          streams.forEach(function (s) {
            found.push({name: 'PencuriMovie MalaySub', title: (o.label || 'MalaySub') + ' · ' + o.host, url: s.url,
              quality: 'Unknown', headers: {Referer: s.referer, 'User-Agent': USER_AGENT}});
          });
        }).catch(function (e) { console.log('[MalaySub] ' + o.host + ': ' + e.message); });
    })).then(function () { return batch(index + batchSize); });
  }
  return batch(0).then(function (streams) {
    var seen = {};
    return streams.filter(function (s) { if (seen[s.url]) return false; seen[s.url] = true; return true; });
  });
}

function findStreams(meta, type, season, episode) {
  var base = baseUrl();
  if (!meta || !meta.title) return Promise.reject(new Error('Tajuk metadata tiada.'));
  var titles = [meta.title];
  if (meta.originalTitle && normalize(meta.originalTitle) !== normalize(meta.title)) titles.push(meta.originalTitle);
  function search(index) {
    if (index >= titles.length) return Promise.resolve([]);
    return request(base + '/?s=' + encodeURIComponent(titles[index])).then(function (html) {
      var entries = searchEntries(html, meta, type, base);
      if (!entries.length) return search(index + 1);
      return request(entries[0].url).then(function (detail) {
        if (type === 'movie') return collectPage(entries[0].url, detail, base);
        var epUrl = episodeUrl(detail, season, episode, base);
        if (!epUrl) return [];
        return request(epUrl).then(function (epHtml) { return collectPage(epUrl, epHtml, base); });
      });
    });
  }
  return search(0);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === 'series' ? 'tv' : mediaType;
  if (type !== 'movie' && type !== 'tv') return Promise.resolve([]);
  if (type === 'tv' && (!/^\d+$/.test(String(season)) || !/^[1-9]\d*$/.test(String(episode)))) return Promise.resolve([]);
  return metadata(tmdbId, type).then(function (meta) { return findStreams(meta, type, season, episode); })
    .catch(function (e) { console.error('[MalaySub] ' + e.message); return []; });
}

function onSettings() {
  return Promise.resolve([
    {type: 'header', label: 'PencuriMovie MalaySub · Beta'},
    {type: 'info', label: 'MixDrop dan video terus disokong. Pelayan lain mungkin tidak mengembalikan sumber. Sarikata bergantung pada video sumber.'},
    {type: 'text', key: 'baseUrl', label: 'Alamat laman sumber', defaultValue: DEFAULT_BASE, placeholder: DEFAULT_BASE},
    {type: 'text', key: 'tmdbApiKey', label: 'TMDB API key (pilihan jika aplikasi menyediakannya)', isPassword: true, placeholder: 'API key v3'}
  ]);
}

module.exports = {getStreams: getStreams, onSettings: onSettings};
// Helpers for offline regression tests and the developer smoke check.
module.exports.testing = {searchEntries: searchEntries, playerOptions: playerOptions, episodeUrl: episodeUrl,
  unpack: unpack, directLinks: directLinks, findStreams: findStreams, safeUrl: safeUrl};
