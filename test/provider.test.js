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

test('manifest points to an executable provider with matching version', () => {
  const scraper = require('../manifest.json').scrapers[0];
  assert.equal(scraper.version, require('../package.json').version);
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', scraper.filename)));
  assert.deepEqual(scraper.supportedTypes, ['movie', 'tv']);
});
