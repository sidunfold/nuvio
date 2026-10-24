'use strict';
// Abyss metadata/segment protocol reference:
// https://github.com/naravid19/N_m3u8DL_RE_GUI/tree/main/N_m3u8DL_RE_GUI.Core/Abyss
// This bridge presents a single seekable MP4 without downloading a complete film.
const http = require('node:http');
const crypto = require('node:crypto');
const {once} = require('node:events');

const ORIGIN = 'https://abyss.msmbot.club';
const USER_AGENT = 'Mozilla/5.0';
const SEGMENT_SIZE = 2097152;
const md5 = bytes => crypto.createHash('md5').update(bytes).digest('hex');
function transform(bytes, hex) {
  const key = Buffer.from(hex, 'ascii');
  const cipher = crypto.createCipheriv('aes-256-ctr', key, key.subarray(0, 16));
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}

function parseMetadata(html) {
  const encoded = html.match(/const\s+datas\s*=\s*["']([^"']+)["']/)?.[1];
  if (!encoded || encoded.length > 500000) throw new Error('Abyss metadata unavailable');
  const data = JSON.parse(Buffer.from(encoded, 'base64').toString('latin1'));
  const key = md5(Buffer.from(`${data.user_id}:${data.slug}:${data.md5_id}`));
  const decoded = JSON.parse(transform(Buffer.from(data.media, 'latin1'), key).toString('utf8'));
  const sources = (decoded.mp4?.sources || []).filter(source => source.status === true &&
    Number.isSafeInteger(source.size) && source.size > 0 && source.size < 100 * 1024 ** 3 &&
    Number.isSafeInteger(source.res_id) && /^[a-z0-9-]+$/i.test(source.sub));
  const domain = decoded.mp4?.domains?.[0] || '';
  // Do not turn metadata into an arbitrary URL fetcher.
  if (!/^[a-z0-9-]+\.sssrr\.org$/i.test(domain) || !Number.isSafeInteger(data.md5_id)) throw new Error('Unsupported Abyss CDN metadata');
  return {slug: data.slug, md5Id: data.md5_id, domainSuffix: 'sssrr.org', sources};
}

function segmentUrl(meta, source, index, partSize = SEGMENT_SIZE) {
  if (!Number.isSafeInteger(partSize) || partSize < 1) throw new Error('Invalid part size');
  const sizeKey = md5(Buffer.from(String(source.size).split('').map(Number)));
  const signed = transform(Buffer.from(`/mp4/${meta.md5Id}/${source.res_id}/${source.size}/${partSize}/${index}`), sizeKey);
  const token = Buffer.from(signed.toString('base64').replace(/=/g, '')).toString('base64').replace(/=/g, '');
  return `https://${source.sub}.${meta.domainSuffix}/sora/${source.size}/${token}`;
}

function parseRange(header, size) {
  if (!header) return {start: 0, end: size - 1, partial: false};
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) throw new Error('Invalid range');
  let start, end;
  if (!m[1]) { const count = Number(m[2]); if (!count) throw new Error('Invalid range'); start = Math.max(0, size - count); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error('Invalid range');
  return {start, end, partial: true};
}

function createBridge(options = {}) {
  const fetcher = options.fetch || fetch;
  const origin = options.origin || ORIGIN;
  const publicBase = String(options.publicBase || '').replace(/\/+$/, '');
  const accessToken = options.token || '';
  const secret = options.signingSecret || crypto.randomBytes(32);
  const cache = new Map();
  const inflight = new Map();
  function sign(path, expires) { return crypto.createHmac('sha256', secret).update(path + ':' + expires).digest('hex'); }
  function equal(a, b) {
    const left = Buffer.from(a || ''), right = Buffer.from(b || '');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  function metadata(slug) {
    if (cache.has(slug) && cache.get(slug).expires > Date.now()) return Promise.resolve(cache.get(slug).value);
    if (inflight.has(slug)) return inflight.get(slug);
    const promise = (async () => {
      const response = await fetcher(origin + '/?v=' + encodeURIComponent(slug), {headers: {'User-Agent': USER_AGENT, Referer: 'https://pencurimoviesubmalay26.site/'}, signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('Abyss HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 1000000) throw new Error('Metadata too large');
      const value = parseMetadata(text);
      if (value.slug !== slug) throw new Error('Video identity mismatch');
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(slug, {expires: Date.now() + 300000, value});
      return value;
    })().finally(() => inflight.delete(slug));
    inflight.set(slug, promise);
    return promise;
  }
  function json(res, code, value) {
    res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'});
    res.end(JSON.stringify(value));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Range', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'}); return res.end(); }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, {error: 'Method not allowed'});
      if (url.pathname === '/health') return json(res, 200, {ok: true, service: 'nuvio-abyss-bridge'});
      if (url.pathname === '/resolve') {
        if (accessToken && !equal(req.headers.authorization, 'Bearer ' + accessToken)) return json(res, 401, {error: 'Unauthorized'});
        if (!publicBase) return json(res, 503, {error: 'ABYSS_PUBLIC_BASE is required'});
        const slug = url.searchParams.get('v') || '';
        if (!/^[a-z0-9_-]{1,80}$/i.test(slug)) return json(res, 400, {error: 'Invalid video ID'});
        const meta = await metadata(slug);
        const expires = String(Math.floor(Date.now() / 1000) + 21600);
        return json(res, 200, {streams: meta.sources.map(source => {
          const path = `/stream/${slug}/${source.res_id}.mp4`;
          return {url: publicBase + path + '?expires=' + expires + '&sig=' + sign(path, expires), quality: source.label, size: source.size};
        })});
      }
      const match = url.pathname.match(/^\/stream\/([a-z0-9_-]{1,80})\/(\d+)\.mp4$/i);
      if (!match) return json(res, 404, {error: 'Not found'});
      const expires = url.searchParams.get('expires') || '';
      if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000 || !equal(url.searchParams.get('sig'), sign(url.pathname, expires))) return json(res, 403, {error: 'Playback link expired or invalid'});
      const meta = await metadata(match[1]);
      const source = meta.sources.find(s => s.res_id === Number(match[2]));
      if (!source) return json(res, 404, {error: 'Resolution unavailable'});
      let range;
      try { range = parseRange(req.headers.range, source.size); }
      catch (_) { res.writeHead(416, {'Content-Range': 'bytes */' + source.size}); return res.end(); }
      const headers = {'Content-Type': 'video/mp4', 'Content-Length': range.end - range.start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'};
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${source.size}`;
      if (req.method === 'HEAD') { res.writeHead(range.partial ? 206 : 200, headers); return res.end(); }
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      let cursor = range.start;
      // The sora API signs virtual byte slices, not the large storage parts in metadata.
      const partSize = options.partSize || SEGMENT_SIZE;
      while (cursor <= range.end && !abort.signal.aborted) {
        const index = Math.floor(cursor / partSize);
        const localStart = cursor - index * partSize;
        const end = Math.min(range.end, (index + 1) * partSize - 1);
        const localEnd = end - index * partSize;
        const timeout = setTimeout(() => abort.abort(), 30000);
        let response;
        try { response = await fetcher(segmentUrl(meta, source, index, partSize), {headers: {'User-Agent': USER_AGENT, Referer: origin + '/?v=' + meta.slug, Range: `bytes=${localStart}-${localEnd}`}, signal: abort.signal}); }
        finally { clearTimeout(timeout); }
        const actual = response.headers.get('content-range') || '';
        if (response.status !== 206 || !actual.startsWith(`bytes ${localStart}-${localEnd}/`)) { await response.body?.cancel(); throw new Error('Abyss range request failed'); }
        if (!res.headersSent) res.writeHead(range.partial ? 206 : 200, headers);
        let bytes = 0;
        for await (const chunk of response.body) {
          if (abort.signal.aborted) break;
          bytes += chunk.length;
          if (bytes > localEnd - localStart + 1) throw new Error('Invalid upstream length');
          if (!res.write(chunk)) await once(res, 'drain', {signal: abort.signal});
        }
        if (!abort.signal.aborted && bytes !== localEnd - localStart + 1) throw new Error('Incomplete upstream range');
        cursor = end + 1;
      }
      if (!abort.signal.aborted) res.end();
    } catch (error) {
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) json(res, 502, {error: 'Abyss is temporarily unavailable'});
      if (options.onError) options.onError(error);
    }
  });
  return server;
}

if (require.main === module) {
  const host = process.env.ABYSS_HOST || '127.0.0.1';
  const port = Number(process.env.ABYSS_PORT || 3147);
  const token = process.env.ABYSS_BRIDGE_TOKEN || '';
  const publicBase = process.env.ABYSS_PUBLIC_BASE || '';
  if (!publicBase || !/^https?:\/\/[^\s?#]+$/.test(publicBase)) throw new Error('Set ABYSS_PUBLIC_BASE to the public bridge URL');
  if (host !== '127.0.0.1' && token.length < 24) throw new Error('A non-local listener requires ABYSS_BRIDGE_TOKEN with at least 24 characters');
  if (!/^https:\/\//.test(publicBase) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(publicBase)) throw new Error('Use HTTPS for a remote public bridge URL');
  createBridge({publicBase, token}).listen(port, host, () => console.log('Abyss bridge listening on ' + host + ':' + port));
}

module.exports = {createBridge, parseMetadata, segmentUrl, parseRange, transform, SEGMENT_SIZE};
