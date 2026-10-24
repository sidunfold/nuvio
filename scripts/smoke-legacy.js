'use strict';
const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const slug = process.argv[2] || 'PAj-fvN1_';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const token = crypto.randomBytes(32).toString('base64');
  const outputDir = path.resolve(__dirname, '../../.codex-work/nuvio-inspect');
  fs.mkdirSync(outputDir, {recursive: true});
  const exe = path.join(outputDir, 'NuvioAbyssLegacy-test.exe');
  const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/out:' + exe, '/reference:System.Web.dll', '/reference:System.Web.Extensions.dll', path.resolve(__dirname, '../bridge/legacy/AbyssBridge.cs')], {windowsHide: true, encoding: 'utf8'});
  if (compiled.status !== 0) throw new Error('Compile failed: ' + compiled.stdout + compiled.stderr);
  const child = spawn(exe, [String(port)], {windowsHide: true, env: {...process.env, ABYSS_PUBLIC_BASE: base, ABYSS_BRIDGE_TOKEN: token}, stdio: ['ignore', 'pipe', 'pipe']});
  let errors = '';
  child.stderr.on('data', b => { errors += b.toString(); });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Legacy process exited: ' + errors);
      try { const r = await fetch(base + '/health'); ready = r.ok && (await r.json()).runtime === 'net-framework'; } catch (_) {}
      if (ready) break;
      await delay(250);
    }
    if (!ready) throw new Error('Legacy process did not become ready: ' + errors);
    if ((await fetch(base + '/resolve?v=' + slug)).status !== 401) throw new Error('Authentication check failed');
    const response = await fetch(base + '/resolve?v=' + slug, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error('Resolve failed: ' + response.status + ' ' + await response.text());
    const result = await response.json();
    if (!result.streams?.length) throw new Error('No Abyss sources');
    for (const stream of result.streams) {
      for (const range of ['bytes=0-1023', 'bytes=2096640-2097663', `bytes=${stream.size - 1024}-${stream.size - 1}`]) {
        const r = await fetch(stream.url, {headers: {Range: range}, signal: AbortSignal.timeout(45000)});
        const bytes = Buffer.from(await r.arrayBuffer());
        if (r.status !== 206 || bytes.length !== 1024) throw new Error(stream.quality + ' ' + range + ': HTTP ' + r.status + ', bytes ' + bytes.length);
        if (range === 'bytes=0-1023' && bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Invalid MP4 header');
        console.log('.NET', stream.quality, range, r.status, bytes.length, 'PASS');
      }
      const head = await fetch(stream.url, {method: 'HEAD', headers: {Range: 'bytes=-1024'}});
      if (head.status !== 206 || head.headers.get('content-length') !== '1024') throw new Error('HEAD check failed');
    }
    if ((await fetch(result.streams[0].url.replace(/sig=\w+/, 'sig=wrong'))).status !== 403) throw new Error('Signature check failed');
    if ((await fetch(result.streams[0].url, {headers: {Range: 'bytes=999999999999-'}})).status !== 416) throw new Error('Range rejection failed');
    console.log('.NET auth, signed links, HEAD and invalid range: PASS');
  } finally { child.kill(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
