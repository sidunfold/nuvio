'use strict';
const {createBridge, SEGMENT_SIZE} = require('../bridge/server');
const slug = process.argv[2] || 'PAj-fvN1_';
(async () => {
  const server = createBridge({publicBase: 'http://127.0.0.1', onError: e => console.error(e.message)});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const resolvedResponse = await fetch(base + '/resolve?v=' + encodeURIComponent(slug));
    if (!resolvedResponse.ok) throw new Error('Resolve failed: ' + resolvedResponse.status);
    const resolved = await resolvedResponse.json();
    for (const stream of resolved.streams) {
      const path = new URL(stream.url);
      const target = base + path.pathname + path.search;
      const ranges = ['bytes=0-1023', `bytes=${SEGMENT_SIZE - 512}-${SEGMENT_SIZE + 511}`, `bytes=${stream.size - 1024}-${stream.size - 1}`];
      for (const range of ranges) {
        const r = await fetch(target, {headers: {Range: range}, signal: AbortSignal.timeout(45000)});
        const bytes = Buffer.from(await r.arrayBuffer());
        if (r.status !== 206 || bytes.length !== 1024) throw new Error(stream.quality + ' range failed: ' + r.status);
        if (range === 'bytes=0-1023' && bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Not an MP4 header');
        console.log(stream.quality, range, r.status, bytes.length, 'PASS');
      }
    }
  } finally { server.closeAllConnections(); server.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
