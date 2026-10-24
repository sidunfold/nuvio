'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createBridge, parseMetadata, parseRange} = require('../bridge/server');
const bytes = Buffer.from('ABCDEFGHIJK');
const slug = 'fixture-video';
const digest = input => crypto.createHash('md5').update(input).digest('hex');
const aes = (input, hex) => {
  const key = Buffer.from(hex), cipher = crypto.createCipheriv('aes-256-ctr', key, key.subarray(0, 16));
  return Buffer.concat([cipher.update(input), cipher.final()]);
};
function metadataHtml() {
  const data = {user_id: 1, slug, md5_id: 42};
  const payload = {mp4: {domains: ['cdn.sssrr.org'], sources: [{status: true, label: '1080p', res_id: 5, size: bytes.length, partSize: 4, sub: 'fixture'}]}};
  data.media = aes(Buffer.from(JSON.stringify(payload)), digest(Buffer.from(`1:${slug}:42`))).toString('latin1');
  return '<script>const datas="' + Buffer.from(JSON.stringify(data), 'latin1').toString('base64') + '";</script>';
}

test('range parsing supports suffix/open-ended requests and rejects invalid or multiple ranges', () => {
  assert.deepEqual(parseRange('bytes=2-8', 11), {start: 2, end: 8, partial: true});
  assert.deepEqual(parseRange('bytes=-3', 11), {start: 8, end: 10, partial: true});
  assert.deepEqual(parseRange('bytes=5-', 11), {start: 5, end: 10, partial: true});
  for (const value of ['bytes=99-', 'bytes=8-2', 'bytes=0-2,4-6', 'bytes=-0']) assert.throws(() => parseRange(value, 11));
});

test('bridge reads metadata, requires authentication and stitches byte ranges across part boundaries', async t => {
  const upstreamCalls = [];
  const server = createBridge({publicBase: 'https://bridge.example', token: 'fixture-access-token', partSize: 4, fetch: async (url, init) => {
    if (url.includes('abyss.msmbot.club')) return new Response(metadataHtml());
    upstreamCalls.push({url, range: init.headers.Range});
    assert.equal(new URL(url).hostname, 'fixture.sssrr.org');
    const token = url.split('/').pop();
    const encoded = Buffer.from(Buffer.from(token, 'base64').toString(), 'base64');
    const key = digest(Buffer.from(String(bytes.length).split('').map(Number)));
    const path = aes(encoded, key).toString();
    const match = path.match(/^\/mp4\/42\/5\/11\/4\/(\d+)$/);
    assert.ok(match);
    const index = Number(match[1]);
    const part = bytes.subarray(index * 4, (index + 1) * 4);
    const m = init.headers.Range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(m[1]), end = Number(m[2]);
    return new Response(part.subarray(start, end + 1), {status: 206, headers: {'Content-Range': `bytes ${start}-${end}/${part.length}`}});
  }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/resolve?v=' + slug)).status, 401);
  const resolved = await (await fetch(base + '/resolve?v=' + slug, {headers: {Authorization: 'Bearer fixture-access-token'}})).json();
  assert.equal(resolved.streams[0].quality, '1080p');
  const play = new URL(resolved.streams[0].url);
  const target = base + play.pathname + play.search;
  const r = await fetch(target, {headers: {Range: 'bytes=2-8'}});
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 2-8/11');
  assert.equal(await r.text(), 'CDEFGHI');
  assert.equal(upstreamCalls.length, 3);
  const head = await fetch(target, {method: 'HEAD', headers: {Range: 'bytes=-3'}});
  assert.equal(head.headers.get('content-length'), '3');
  assert.equal(upstreamCalls.length, 3);
  assert.equal((await fetch(target, {headers: {Range: 'bytes=100-'}})).status, 416);
  assert.equal((await fetch(target.replace(/sig=\w+/, 'sig=wrong'))).status, 403);
  assert.equal((await fetch(base + '/resolve?v=http://localhost', {headers: {Authorization: 'Bearer fixture-access-token'}})).status, 400);
});

test('metadata cannot redirect the bridge to arbitrary hosts', () => {
  assert.throws(() => parseMetadata('<html>no metadata</html>'));
});
