'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {testing: h} = require('../providers/pencurimovie');
const base = 'https://pencurimoviesubmalay26.site';

test('matches exact title, year and media type, excluding related titles', () => {
  const html = `<a href="${base}/movies/hope-2013/" title="Hope (2013)"></a>
    <a title='Hope (2026)' href='${base}/movies/hope-2026/'></a>
    <a href="${base}/movies/hope-2/" title="Hope 2 (2026)"></a>
    <a href="${base}/tvshows/hope/" title="Hope (2026)"></a>
    <a href="https://elsewhere.example/movies/hope/" title="Hope (2026)"></a>`;
  assert.deepEqual(h.searchEntries(html, {title: 'Hope', year: '2026'}, 'movie', base), [{url: base + '/movies/hope-2026/', title: 'Hope (2026)'}]);
  assert.equal(h.searchEntries(html, {title: 'Missing'}, 'movie', base).length, 0);
});

test('matches entities and original titles', () => {
  const html = `<a href='${base}/movies/a/' title='Alice &amp; Bob (2020)'></a>`;
  assert.equal(h.searchEntries(html, {title: 'Other', originalTitle: 'Alice & Bob', year: '2020'}, 'movie', base).length, 1);
});

test('excludes fake advertisement player option', () => {
  const html = `<li class='zetaflix_player_option' data-type='mv' data-post='42' data-nume='1'><span class='opt-titl'>mixdrop</span><span class='opt-name'>MalaySub</span></li>
    <li class='zetaflix_player_option' data-type='mv' data-post='42' data-nume='fake'><span>Full HD</span></li>`;
  assert.deepEqual(h.playerOptions(html), [{post: '42', type: 'mv', nume: '1', host: 'mixdrop', label: 'MalaySub'}]);
});

test('selects episode 1 without confusing episode 10 or another season', () => {
  const html = `<a href='${base}/episodes/show-s1-e10/'></a><a href='${base}/episodes/show-s2-e1/'></a><a href='${base}/episodes/show-s1-e1/'></a>`;
  assert.equal(h.episodeUrl(html, 1, 1, base), base + '/episodes/show-s1-e1/');
  assert.equal(h.episodeUrl(html, 3, 1, base), '');
});

test('finds Lanterns ep-style slugs while preserving the requested season and episode', () => {
  const html = `<a href='${base}/episodes/lanterns-s1-ep8/'></a><a href='${base}/episodes/lanterns-s1-ep10/'></a><a href='${base}/episodes/lanterns-s2-ep1/'></a><a href='${base}/episodes/lanterns-s1-ep1/'></a>`;
  assert.equal(h.episodeUrl(html, 1, 1, base), base + '/episodes/lanterns-s1-ep1/');
  assert.equal(h.episodeUrl(html, 1, 8, base), base + '/episodes/lanterns-s1-ep8/');
  assert.equal(h.episodeUrl(html, 1, 2, base), '');
});

test('unpacks MixDrop without eval and preserves signed URL parameters', () => {
  const packed = "eval(function(p,a,c,k,e,d){return p}('0.1=\"//2/3.4?s=token&e=123\";',10,5,'MDCore|wurl|cdn.example|video|mp4'.split('|'),0,{}))";
  assert.deepEqual(h.directLinks(packed, 'https://mixdrop.example/e/1'), ['https://cdn.example/video.mp4?s=token&e=123']);
  assert.deepEqual(h.directLinks('<img src="https://cdn.example/poster.jpg"><script>MDCore.vfile="relative.mp4"</script>', base), []);
  assert.equal(h.safeUrl('javascript:alert(1)', base), '');
});

function runtime(fetch, globals = {}) {
  const context = {module: {exports: {}}, fetch, console: {log() {}, error() {}}, ...globals};
  vm.runInNewContext(fs.readFileSync(require.resolve('../providers/pencurimovie'), 'utf8'), context);
  return context.module.exports;
}

test('full getStreams contract works without DOM, Node globals, timers or require', async () => {
  const calls = [];
  const provider = runtime(async (url, options) => {
    calls.push({url, options});
    let text;
    if (url.includes('api.themoviedb.org')) text = JSON.stringify({title: 'Example', release_date: '2024-01-01'});
    else if (url.includes('/?s=')) text = `<a href='${base}/movies/example/' title='Example (2024)'></a>`;
    else if (url.endsWith('/movies/example/')) text = `<li class='zetaflix_player_option' data-type='mv' data-post='12' data-nume='1'><span class='opt-titl'>mixdrop</span></li>`;
    else if (url.includes('admin-ajax.php')) {
      assert.match(options.body, /action=zeta_player_ajax&post=12&type=mv&nume=1/);
      text = JSON.stringify({embed_url: '<iframe src="https://mixdrop.example/e/1"></iframe>'});
    } else if (url === 'https://mixdrop.example/e/1') text = 'MDCore.wurl="//cdn.example/video.mp4?s=token"';
    else throw new Error('Unexpected request ' + url);
    return {ok: true, text: async () => text};
  }, {TMDB_API_KEY: 'test-key'});
  const streams = await provider.getStreams('123', 'movie');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/video.mp4?s=token');
  assert.equal(streams[0].headers.Referer, 'https://mixdrop.example/e/1');
  assert.equal(calls.length, 5);
});

test('invalid input and missing credentials make no network requests', async () => {
  const provider = runtime(() => { throw new Error('Must not fetch'); });
  assert.equal((await provider.getStreams('123', 'movie')).length, 0);
  assert.equal((await provider.getStreams('123', 'music')).length, 0);
  assert.equal((await provider.getStreams('123', 'tv', 1, 0)).length, 0);
});

test('TV episodes return MixDrop immediately without waiting on an unresponsive fallback', async () => {
  const calls = [];
  const provider = runtime(async (url, options) => {
    calls.push(url);
    let text;
    if (url.includes('api.themoviedb.org')) text = JSON.stringify({name: 'Lanterns', first_air_date: '2026-01-01'});
    else if (url.includes('/?s=')) text = `<a href='${base}/tvshows/lanterns/' title='Lanterns'></a>`;
    else if (url.endsWith('/tvshows/lanterns/')) text = `<a href='${base}/episodes/lanterns-s1-ep3/'></a><a href='${base}/episodes/lanterns-s1-ep7/'></a>`;
    else if (/\/episodes\//.test(url)) text = `<li class='zetaflix_player_option' data-type='ep' data-post='181988' data-nume='1'><span class='opt-titl'>playe</span></li><li class='zetaflix_player_option' data-type='ep' data-post='181988' data-nume='9'><span class='opt-titl'>mixdr</span></li>`;
    else if (url.includes('admin-ajax.php')) {
      // If the fallback is ever requested, it never finishes, as on a slow host.
      if (options.body.includes('nume=1')) return new Promise(() => {});
      assert.match(options.body, /type=ep&nume=9/);
      text = JSON.stringify({embed_url: '<iframe src="https://mixdrop.example/e/episode"></iframe>'});
    } else if (url === 'https://mixdrop.example/e/episode') text = 'MDCore.wurl="//cdn.example/episode.mp4?s=token"';
    else throw new Error('Unexpected request ' + url);
    return {ok: true, text: async () => text};
  }, {TMDB_API_KEY: 'test-key'});
  for (const episode of [3, 7]) {
    const streams = await provider.getStreams('123', 'tv', 1, episode);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, 'https://cdn.example/episode.mp4?s=token');
    assert.ok(calls.includes(base + '/episodes/lanterns-s1-ep' + episode + '/'));
  }
  assert.equal(calls.filter(url => url.includes('admin-ajax.php')).length, 2);
});

test('manifest points to an executable provider with matching version', () => {
  const scraper = require('../manifest.json').scrapers[0];
  assert.equal(scraper.version, require('../package.json').version);
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', scraper.filename)));
  assert.deepEqual(scraper.supportedTypes, ['movie', 'tv']);
});

test('quality comes from the matching video or its file title, never unrelated page text', () => {
  const page = 'https://mixdrop.example/e/1';
  const url = 'https://cdn.example/opaque.mp4';
  assert.equal(h.videoQuality('<div class="title"><a>Lanterns.S01E03.1080p.WEB.mp4</a></div>', url, page, true), '1080p');
  assert.equal(h.videoQuality('<div>Watch more movies in 1080p</div><img alt="1080p">', url, page, true), 'Unknown');
  const html = `<source src='${url}' label='720p'><source src='https://cdn.example/other.mp4' label='1080p'>`;
  assert.equal(h.videoQuality(html, url, page, false), '720p');
  assert.equal(h.videoQuality('<div class="title"><a>Movie.1080p</a></div>', url, page, false), 'Unknown');
  assert.equal(h.qualityLabel('1920x1080'), '1080p');
  assert.equal(h.qualityLabel('720'), '720p');
  assert.equal(h.qualityLabel('HD'), 'Unknown');
});

test('all available resolutions remain selectable, and a missing requested resolution returns empty', async () => {
  for (const selected of ['all', '1080p', '720p', '480p']) {
    const provider = runtime(async (url, options) => {
      let text;
      if (url.includes('api.themoviedb.org')) text = JSON.stringify({title: 'Example', release_date: '2024-01-01'});
      else if (url.includes('/?s=')) text = `<a href='${base}/movies/example/' title='Example (2024)'></a>`;
      else if (url.endsWith('/movies/example/')) text = [1, 2].map(n => `<li class='zetaflix_player_option' data-type='mv' data-post='12' data-nume='${n}'><span class='opt-titl'>mixdr</span></li>`).join('');
      else if (url.includes('admin-ajax.php')) {
        const number = options.body.match(/nume=(\d+)/)[1];
        text = JSON.stringify({embed_url: `<iframe src="https://mixdrop.example/e/${number}"></iframe>`});
      } else if (url.startsWith('https://mixdrop.example/e/')) {
        const quality = url.endsWith('/1') ? '1080p' : '720p';
        text = `<div class="title"><a>Example.${quality}.mp4</a></div><source src="https://cdn.example/${quality}.mp4">`;
      } else throw new Error('Unexpected request ' + url);
      return {ok: true, text: async () => text};
    }, {TMDB_API_KEY: 'test-key', SCRAPER_SETTINGS: {resolution: selected}});
    const streams = await provider.getStreams('123', 'movie');
    assert.equal(streams.length, selected === 'all' ? 2 : selected === '480p' ? 0 : 1);
    assert.ok(streams.every(s => selected === 'all' || s.quality === selected));
    assert.ok(streams.every(s => s.title.startsWith(s.quality + ' · ')));
    const blueprint = await provider.onSettings();
    const selector = blueprint.find(x => x.key === 'resolution');
    assert.equal(selector.defaultValue, 'all');
    assert.ok(selector.options.some(x => x.value === selected));
  }
});

test('an unknown-quality video cannot pass a specific resolution filter', async () => {
  const original = global.SCRAPER_SETTINGS;
  try {
    global.SCRAPER_SETTINGS = {resolution: '1080p'};
    assert.equal(h.acceptsQuality('Unknown'), false);
    assert.equal(h.acceptsQuality('720p'), false);
    assert.equal(h.acceptsQuality('1080p'), true);
    global.SCRAPER_SETTINGS = {resolution: 'all'};
    assert.equal(h.acceptsQuality('Unknown'), true);
  } finally { global.SCRAPER_SETTINGS = original; }
});

test('Abyss uses the configured authenticated bridge and honors resolution and server selection', async () => {
  const provider = runtime(async (url, options) => {
    let text;
    if (url.includes('api.themoviedb.org')) text = JSON.stringify({title: 'Example'});
    else if (url.includes('/?s=')) text = `<a href='${base}/movies/example/' title='Example'></a>`;
    else if (url.endsWith('/movies/example/')) text = `<li class='zetaflix_player_option' data-type='mv' data-post='12' data-nume='1'><span class='opt-titl'>abyss</span></li><li class='zetaflix_player_option' data-type='mv' data-post='12' data-nume='2'><span class='opt-titl'>mixdr</span></li>`;
    else if (url.includes('admin-ajax.php')) {
      assert.match(options.body, /nume=1$/);
      text = JSON.stringify({embed_url: '<iframe src="https://abyss.msmbot.club/?v=fixture"></iframe>'});
    } else if (url === 'https://bridge.example/resolve?v=fixture') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      text = JSON.stringify({streams: [{url: 'https://bridge.example/stream/fixture/5.mp4?sig=test', quality: '1080p'}, {url: 'https://bridge.example/stream/fixture/4.mp4?sig=test', quality: '720p'}]});
    } else throw new Error('Unexpected request ' + url);
    return {ok: true, text: async () => text};
  }, {TMDB_API_KEY: 'fixture', SCRAPER_SETTINGS: {server: 'abyss', resolution: '720p', abyssBridgeUrl: 'https://bridge.example', abyssBridgeToken: 'fixture-token'}});
  const streams = await provider.getStreams('123', 'movie');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].quality, '720p');
  assert.match(streams[0].url, /\/stream\/fixture\/4\.mp4/);
});
