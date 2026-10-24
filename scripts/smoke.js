'use strict';
const {testing} = require('../providers/pencurimovie');
const title = process.argv[2] || 'Badut Gendong';
const year = process.argv[3] || '2026';
const mediaType = process.argv[4] || 'movie';
const season = Number(process.argv[5] || 1);
const episode = Number(process.argv[6] || 1);
testing.findStreams({title, year}, mediaType, season, episode).then(async streams => {
  console.log('Streams extracted:', streams.length);
  if (!streams.length) throw new Error('Tiada video terus ditemui; periksa host dan tajuk.');
  let playable = 0;
  for (const s of streams) {
    // Verify a tiny range, never download a full film or print expiring stream tokens.
    const r = await fetch(s.url, {headers: {...s.headers, Range: 'bytes=0-1023'}, signal: AbortSignal.timeout(15000)});
    const type = r.headers.get('content-type') || '';
    const reader = r.body?.getReader();
    const chunk = await reader?.read();
    await reader?.cancel();
    const ok = (r.status === 200 || r.status === 206) && /video|mpegurl|octet-stream/i.test(type) && chunk?.value?.length > 0;
    if (ok) playable++;
    console.log(s.title, 'HTTP', r.status, type, ok ? 'PASS' : 'FAIL');
  }
  if (!playable) throw new Error('Pautan diekstrak tetapi pengesahan video gagal.');
}).catch(e => { console.error(e.message); process.exitCode = 1; });
