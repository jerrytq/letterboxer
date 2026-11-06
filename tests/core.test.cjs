const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
vm.runInThisContext(fs.readFileSync('core.js', 'utf8'));
const core = globalThis.Letterboxer;

test('search handles accents, punctuation, partial titles, multiple words and years', () => {
  const films = [
    { slug: 'dune', title: 'Dune', year: '1984' },
    { slug: 'dune-2021', title: 'Dune', year: '2021' },
    { slug: 'amelie', title: 'Amélie', year: '2001' },
    { slug: 'wall-e', title: 'WALL·E', year: '2008' },
  ];
  assert.equal(core.search(films, '  dune ').length, 2);
  assert.equal(core.search(films, '2021 dun')[0].slug, 'dune-2021');
  assert.equal(core.search(films, 'amel')[0].slug, 'amelie');
  assert.equal(core.search(films, 'wall-e')[0].slug, 'wall-e');
  assert.equal(core.search(films, 'nonexistent').length, 0);
  assert.equal(core.search(films, ' ').length, 0);
});

test('pagination confines requests to the intended member and unfiltered collection', () => {
  assert.equal(core.pageNumber('/jerry/films/page/2/', 'jerry'), 2);
  assert.equal(core.pageNumber('/JERRY/films/', 'jerry'), 1);
  for (const url of ['https://evil.test/jerry/films/', '/someoneelse/films/', '/jerry/films/genre/horror/', '/jerry/films/page/0/', '/jerry/films/?page=2']) {
    assert.throws(() => core.pageNumber(url, 'jerry'));
  }
});

test('crawler searches across pages and deduplicates films that move between pages', async () => {
  const urls = [], progress = [];
  const result = await core.crawl({
    member: 'jerry', signal: new AbortController().signal, delay: 0,
    fetchPage: async (url) => { urls.push(url); return url; },
    parse: (_doc, _member, page) => ({
      films: page === 1 ? [{ slug: 'a', title: 'A' }] : [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }],
      nextPage: page === 1 ? 2 : null,
    }), onProgress: (state) => progress.push(state),
  });
  assert.deepEqual(urls, ['https://letterboxd.com/jerry/films/', 'https://letterboxd.com/jerry/films/page/2/']);
  assert.equal(result.length, 2);
  assert.equal(progress[0].complete, false);
  assert.equal(progress[1].complete, true);
});

test('stopping while waiting prevents further requests', async () => {
  const controller = new AbortController();
  let requests = 0;
  const work = core.crawl({
    member: 'jerry', signal: controller.signal, delay: 10000,
    fetchPage: async () => { requests++; return {}; },
    parse: () => ({ films: [], nextPage: 2 }),
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('network failures never produce a complete result', async () => {
  const progress = [];
  await assert.rejects(core.crawl({
    member: 'jerry', signal: new AbortController().signal, delay: 0,
    fetchPage: async (url) => { if (url.includes('/page/2/')) throw new Error('429'); return {}; },
    parse: () => ({ films: [{ slug: 'a', title: 'A' }], nextPage: 2 }),
    onProgress: (state) => progress.push(state),
  }), /429/);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].complete, false);
});

test('aborting during a fetch discards the response', async () => {
  const controller = new AbortController();
  let parsed = false;
  await assert.rejects(core.crawl({
    member: 'jerry', signal: controller.signal,
    fetchPage: async () => { controller.abort(); return {}; },
    parse: () => { parsed = true; return { films: [], nextPage: null }; },
  }), { name: 'AbortError' });
  assert.equal(parsed, false);
});

test('comparison uses film identity, half stars, unrated values and unknown ratings', () => {
  const films = [
    { slug: 'dune', title: 'Dune', rating: 8 },
    { slug: 'dune-2021', title: 'Dune', rating: 9 },
    { slug: 'unrated', rating: null },
    { slug: 'unknown', rating: undefined },
  ];
  const entries = [
    { id: '1', slug: 'dune', rating: 8 },
    { id: '2', slug: 'dune', rating: 7 },
    { id: '3', slug: 'dune-2021', rating: 8 },
    { id: '4', slug: 'unrated', rating: null },
    { id: '5', slug: 'unrated', rating: 1 },
    { id: '6', slug: 'dune', rating: null },
    { id: '7', slug: 'unknown', rating: 8 },
    { id: '8', slug: 'missing', rating: null },
    { id: '9', slug: 'dune', rating: undefined },
  ];
  assert.deepEqual(core.compareRatings(entries, films).map((entry) => entry.status),
    ['match', 'different', 'different', 'match', 'different', 'different', 'unavailable', 'unavailable', 'unavailable']);
  assert.equal(entries[0].status, undefined, 'Input must remain unchanged');
});

test('rating labels distinguish no rating from unreadable metadata', () => {
  assert.equal(core.formatRating(1), '0.5 ★');
  assert.equal(core.formatRating(9), '4.5 ★');
  assert.equal(core.formatRating(10), '5 ★');
  assert.equal(core.formatRating(null), 'Unrated');
  assert.equal(core.formatRating(undefined), 'Unavailable');
  assert.equal(core.formatRating(11), 'Unavailable');
});

test('diary pagination preserves every rewatch and confines requests to diary pages', async () => {
  assert.equal(core.pageNumber('/jerry/diary/page/2/', 'jerry', 'diary'), 2);
  assert.throws(() => core.pageNumber('/jerry/films/page/2/', 'jerry', 'diary'));
  assert.equal(core.pageNumber('/jerry/diary/films/page/2/', 'jerry', 'diary'), 2);
  assert.throws(() => core.pageNumber('/someoneelse/diary/films/page/2/', 'jerry', 'diary'));
  const urls = [];
  const entries = await core.crawl({
    member: 'jerry', collection: 'diary', key: (entry) => entry.id, delay: 0,
    signal: new AbortController().signal,
    fetchPage: async (url) => { urls.push(url); return {}; },
    parse: (_doc, _member, page) => ({ films: [{ id: String(page), slug: 'dune', rating: page === 1 ? 8 : 9 }], nextPage: page === 1 ? 2 : null }),
  });
  assert.equal(entries.length, 2);
  assert.deepEqual(urls, ['https://letterboxd.com/jerry/diary/', 'https://letterboxd.com/jerry/diary/page/2/']);
});

test('average uses histogram counts as weights and includes half stars', () => {
  const bins = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0];
  assert.deepEqual(core.averageFromHistogram(bins), { count: 2, average: 2.25 });
  assert.deepEqual(core.averageFromHistogram([0, 0, 0, 0, 0, 0, 0, 0, 0, 5]), { count: 5, average: 5 });
  assert.deepEqual(core.averageFromHistogram(Array(10).fill(0)), { count: 0, average: null });
});

test('histogram average rejects partial, negative, approximate or unsafe counts', () => {
  for (const bins of [[1], Array(10).fill(-1), Array(10).fill(1.5), Array(10).fill('2'), Array(10).fill(Number.MAX_SAFE_INTEGER)]) {
    assert.throws(() => core.averageFromHistogram(bins));
  }
});
