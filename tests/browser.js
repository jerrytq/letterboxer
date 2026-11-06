(async () => {
  const report = document.getElementById('report');
  let passed = 0, failed = 0;
  const lines = [];
  const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
  const doc = (html) => new DOMParser().parseFromString(html, 'text/html');
  const grid = (items, next = '') => `<main><ul class="poster-list">${items}</ul>${next}</main>`;
  const poster = (slug, title) => `<li><div data-film-slug="${slug}"><img alt="${title}"></div></li>`;
  const legacy = grid(poster('dune', 'Dune (1984)') + poster('amelie', 'Amélie'));
  const modern = '<main><ul class="grid"><li><div data-component-class="LazyPoster" data-item-slug="dune-part-two" data-item-name="Dune: Part Two (2024)"></div></li></ul></main>';
  const diaryRow = (id, slug, title, rating = '') => `<tr class="diary-entry-row" data-viewing-id="${id}"><td class="td-calendar"><span class="month">Nov</span><span class="year">2026</span></td><td class="td-day"><a href="/tester/diary/for/2026/11/05/">05</a></td><td class="td-film-details"><h3><a href="/film/${slug}/">${title}</a></h3></td><td class="td-rating">${rating}</td><td class="td-review"><a href="/tester/film/${slug}/${id}/">Entry</a></td></tr>`;
  const diary = (rows, next = '') => `<main><table id="diary-table"><tbody>${rows}</tbody></table>${next}</main>`;
  const stars = (n) => `<span class="rating rated-${n}"></span>`;
  const histogram = (bins) => `<table class="rating-histogram"><caption>Rating Distribution</caption><tbody>${bins.map((count, i) => {
    const score = i % 2 === 0 ? `${i === 0 ? '' : Math.floor((i + 1) / 2)}½` : String((i + 1) / 2);
    return `<tr><td>${score}</td><td><a href="/tester/films/ratings/rated/${encodeURIComponent(score)}/by/date/">${count.toLocaleString('en-US')} (0%)</a></td></tr>`;
  }).join('')}</tbody></table>`;
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('Timed out waiting for UI');
  };
  async function test(name, run) {
    try { await run(); passed++; lines.push(`PASS ${name}`); }
    catch (err) { failed++; lines.push(`FAIL ${name}: ${err.message}`); }
    report.textContent = lines.join('\n');
  }
  const rejects = (run) => { let threw = false; try { run(); } catch { threw = true; } assert(threw, 'Expected parser to reject'); };

  await test('Legacy posters, accents, missing years', () => {
    const result = Letterboxer.parsePage(doc(legacy), 'tester', 1);
    assert(result.films.length === 2);
    assert(result.films[0].title === 'Dune' && result.films[0].year === '1984');
    assert(result.films[1].title === 'Amélie' && result.films[1].year === '');
  });
  await test('Modern LazyPoster metadata without loaded images', () => {
    const result = Letterboxer.parsePage(doc(modern), 'tester', 1);
    assert(result.films[0].slug === 'dune-part-two' && result.films[0].year === '2024');
  });
  await test('Film links, HTML entities, unrated films', () => {
    const result = Letterboxer.parsePage(doc(grid('<li><div data-target-link="/film/a-b/"><img alt="A &amp; B"></div></li>')), 'tester', 1);
    assert(result.films[0].title === 'A & B');
  });
  await test('Next page works; unrelated posters are excluded', () => {
    const html = legacy.replace('</main>', '<div class="pagination"><a class="next" href="/tester/films/page/2/">Next</a></div></main>') + '<aside data-film-slug="unrelated"><img alt="Unrelated"></aside>';
    const result = Letterboxer.parsePage(doc(html), 'tester', 1);
    assert(result.nextPage === 2 && result.films.length === 2);
  });
  await test('Empty collection is recognized', () => {
    assert(Letterboxer.parsePage(doc('<main><p>tester hasn’t watched any films.</p></main>'), 'tester', 1).films.length === 0);
  });
  await test('Challenges, login pages, missing titles and skipped posters fail clearly', () => {
    for (const html of ['<title>Just a moment...</title>', '<main>Please sign in</main>', grid('<li><div data-film-slug="missing"></div></li>'), grid(poster('a', 'A') + '<li><div>Unknown poster</div></li>')]) {
      rejects(() => Letterboxer.parsePage(doc(html), 'tester', 1));
    }
  });
  await test('Missing next link and unsafe or looping pagination are rejected', () => {
    for (const link of ['<div class="pagination"><a href="/tester/films/page/2/">2</a></div>', '<a class="next" href="https://evil.test/">Next</a>', '<a class="next" href="/tester/films/">Next</a>']) {
      rejects(() => Letterboxer.parsePage(doc(grid(poster('a', 'A'), link)), 'tester', 1));
    }
  });
  await test('Film ratings come from the member, not viewer or average ratings; parsing ratings is optional', () => {
    const html = grid('<li><div data-film-slug="dune"><img alt="Dune"></div><p class="poster-viewingdata">' + stars(9) + '</p><span class="average-rating">' + stars(6) + '</span></li>' + poster('unrated', 'Unrated film'));
    const result = Letterboxer.parsePage(doc(html), 'tester', 1, { includeRatings: true });
    assert(result.films[0].rating === 9 && result.films[1].rating === null);
    assert(!('rating' in Letterboxer.parsePage(doc(html), 'tester', 1).films[0]));
  });
  await test('Diary parser preserves rewatch IDs, dates, links, half stars and unrated entries', () => {
    const html = diary(diaryRow('1', 'dune', 'Dune', stars(7)) + diaryRow('2', 'dune', 'Dune') + diaryRow('3', 'half', 'Half', '<span class="rating">½</span>'));
    const entries = Letterboxer.parseDiaryPage(doc(html), 'tester', 1).films;
    assert(entries.length === 3 && entries[0].id !== entries[1].id);
    assert(entries[0].date === '2026-11-05' && entries[0].rating === 7);
    assert(entries[0].url === 'https://letterboxd.com/tester/film/dune/1/');
    assert(entries[1].rating === null && entries[2].rating === 1);
  });
  await test('Diary parser reads nested poster metadata and film links without trailing slashes', () => {
    const nested = '<tr class="diary-entry-row" data-viewing-id="nested"><td class="td-film-details"><div data-component-class="LazyPoster" data-item-slug="another-earth" data-item-name="Another Earth"></div><h3>Another Earth</h3></td><td class="td-rating">' + stars(7) + '</td></tr>';
    const noSlash = diaryRow('plain', 'another-earth', 'Another Earth', stars(8)).replaceAll('/film/another-earth/', '/film/another-earth');
    const entries = Letterboxer.parseDiaryPage(doc(diary(nested + noSlash)), 'tester', 1).films;
    assert(entries.length === 2 && entries.every((entry) => entry.slug === 'another-earth'));
    assert(entries[0].title === 'Another Earth' && entries[0].rating === 7);
  });
  await test('Unreadable diary entries remain visible as unable to compare; table headers are excluded', () => {
    const unknown = '<tr class="diary-entry-row" data-viewing-id="unknown"><td class="td-film-details"><h3>Unavailable film</h3></td><td class="td-rating">' + stars(8) + '</td></tr>';
    const entries = Letterboxer.parseDiaryPage(doc(diary('<tr><th>Film</th><th>Rating</th></tr>' + unknown + diaryRow('known', 'dune', 'Dune', stars(7)))), 'tester', 1).films;
    assert(entries.length === 2, 'Do not drop a real entry or count a header');
    assert(entries[0].slug === null && entries[0].title === 'Unavailable film');
    assert(entries[0].url === 'https://letterboxd.com/tester/diary/');
    const results = Letterboxer.compareRatings(entries, [{ slug: 'dune', rating: 8 }]);
    assert(results[0].status === 'unavailable' && results[1].status === 'different');
  });
  await test('Actual saved jerrytq diary: all 50 titles, dates and star ratings are read', async () => {
    const html = await (await fetch('fixtures/jerrytq-diary.html')).text();
    const result = Letterboxer.parseDiaryPage(doc(html), 'jerrytq', 1);
    assert(result.films.length === 50);
    assert(result.films.every((entry) => entry.slug && entry.title !== 'Film title unavailable' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isInteger(entry.rating)));
    const first = result.films[0];
    assert(first.title === 'Tokyo Gore Police' && first.slug === 'tokyo-gore-police');
    assert(first.rating === 7 && first.date === '2026-11-05' && first.id === '1572946521');
    assert(first.url === 'https://letterboxd.com/jerrytq/diary/films/for/2026/11/05/');
    const counts = Array(10).fill(0);
    result.films.forEach((entry) => counts[entry.rating - 1]++);
    assert(JSON.stringify(counts) === JSON.stringify([4, 4, 9, 3, 5, 3, 8, 10, 3, 1]), 'Every extracted rating must match the saved page');
    assert(result.nextPage === 2 && result.nextURL === 'https://letterboxd.com/jerrytq/diary/films/page/2/');
  });
  await test('Diary crawler follows the exact current Films-tab pagination URL', async () => {
    const html = await (await fetch('fixtures/jerrytq-diary.html')).text();
    const urls = [];
    const entries = await Letterboxer.crawl({ member: 'jerrytq', collection: 'diary', key: (entry) => entry.id,
      signal: new AbortController().signal, delay: 0, parse: Letterboxer.parseDiaryPage,
      fetchPage: async (url) => {
        urls.push(url);
        return doc(urls.length === 1 ? html : diary(diaryRow('page-2', 'dune', 'Dune', stars(8))).replaceAll('/tester/', '/jerrytq/'));
      }
    });
    assert(entries.length === 51);
    assert(urls[1] === 'https://letterboxd.com/jerrytq/diary/films/page/2/');
  });
  await test('Unreadable rating markers remain unavailable; a missing diary rating cell is unknown', () => {
    assert(Letterboxer.readRating(doc('<span class="rating">?</span>').body) === undefined);
    assert(Letterboxer.readRating(doc(stars(99)).body) === undefined);
    const html = diary(diaryRow('1', 'dune', 'Dune').replace('<td class="td-rating"></td>', ''));
    assert(Letterboxer.parseDiaryPage(doc(html), 'tester', 1).films[0].rating === undefined);
  });
  await test('Empty diary, unreadable diary and unsafe diary pagination', () => {
    assert(Letterboxer.parseDiaryPage(doc('<main>No diary entries.</main>'), 'tester', 1).films.length === 0);
    rejects(() => Letterboxer.parseDiaryPage(doc('<main>Sign in</main>'), 'tester', 1));
    rejects(() => Letterboxer.parseDiaryPage(doc(diary(diaryRow('1', 'dune', 'Dune'), '<a class="next" href="/tester/films/page/2/">Next</a>')), 'tester', 1));
  });
  await test('UI loads all pages, searches, caches, restores and clears', async () => {
    const source = await (await fetch('../content.js')).text();
    const storage = { 'letterboxer:v1:tester': { films: [{ slug: 'old', title: 'Old cache' }], savedAt: Date.now(), complete: true } };
    let requests = 0;
    const chromeMock = { storage: { local: {
      get: async (key) => key ? { [key]: storage[key] } : { ...storage },
      set: async (data) => Object.assign(storage, data),
      remove: async (keys) => { for (const key of [keys].flat()) delete storage[key]; },
    } } };
    const fakeLocation = { pathname: '/tester/films/genre/horror/' };
    const fakeFetch = async (url) => {
      requests++;
      const html = url.includes('/page/2/') ? modern.replace('</li>', `<p class="poster-viewingdata">${stars(9)}</p></li>`)
        : legacy.replace('</li>', '<p class="poster-viewingdata"><span class="rating">?</span></p></li>').replace('</main>', '<a class="next" href="/tester/films/page/2/">Next</a></main>');
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const mount = () => new Function('location', 'chrome', 'fetch', source)(fakeLocation, chromeMock, fakeFetch);
    mount();
    let root = document.getElementById('letterboxer-search').shadowRoot;
    root.getElementById('load').click();
    await waitFor(() => storage['letterboxer:v1:tester']?.schema === 2);
    assert(requests === 2, 'Must fetch both pages');
    assert(storage['letterboxer:v1:tester'].films.find((film) => film.slug === 'dune').rating === 'unavailable');
    const query = root.getElementById('query');
    query.value = 'part two'; query.dispatchEvent(new Event('input'));
    assert(root.querySelectorAll('li').length === 1);
    assert(root.querySelector('li a').href === 'https://letterboxd.com/film/dune-part-two/');
    assert(root.querySelector('li .rating').textContent === '★★★★½');
    assert(root.querySelector('li .rating').getAttribute('aria-label').includes('4.5 out of 5'));
    assert(root.getElementById('status').textContent.includes('3 films'));
    document.getElementById('letterboxer-search').remove();
    mount();
    root = document.getElementById('letterboxer-search').shadowRoot;
    await waitFor(() => !root.getElementById('refresh').hidden);
    assert(requests === 2, 'Cache restore must not fetch');
    const restoredQuery = root.getElementById('query');
    restoredQuery.value = 'part two'; restoredQuery.dispatchEvent(new Event('input'));
    assert(root.querySelector('li .rating').textContent === '★★★★½', 'Cache must preserve half stars');
    restoredQuery.value = 'amelie'; restoredQuery.dispatchEvent(new Event('input'));
    assert(root.querySelector('li .rating').textContent === 'Unrated');
    restoredQuery.value = '1984'; restoredQuery.dispatchEvent(new Event('input'));
    assert(root.querySelector('li .rating').textContent === 'Unavailable', 'Unknown must not become unrated');
    root.getElementById('clear').click();
    await waitFor(() => !storage['letterboxer:v1:tester']);
    assert(!root.getElementById('load').hidden);
  });
  await test('Comparison UI loads fresh Films ratings and all diary pages; filters all rewatches', async () => {
    const source = await (await fetch('../diary.js')).text();
    const urls = [];
    const filmHTML = grid('<li><div data-film-slug="dune"><img alt="Dune"></div><p class="poster-viewingdata">' + stars(8) + '</p></li>' + poster('unrated', 'Unrated'));
    const page1 = diary(diaryRow('1', 'dune', 'Dune', stars(7)) + diaryRow('2', 'dune', 'Dune', stars(8)), '<a class="next" href="/tester/diary/page/2/">Next</a>');
    const page2 = diary(diaryRow('3', 'unrated', 'Unrated', stars(1)) + diaryRow('4', 'missing', 'Missing', stars(9)) + '<tr class="diary-entry-row" data-viewing-id="unreadable"><td class="td-film-details"><h3>Unavailable film</h3></td><td class="td-rating">' + stars(8) + '</td></tr>');
    const fakeFetch = async (url) => {
      urls.push(url);
      return new Response(url.includes('/films/') ? filmHTML : url.includes('/page/2/') ? page2 : page1, { headers: { 'content-type': 'text/html' } });
    };
    new Function('location', 'fetch', source)({ pathname: '/tester/diary/for/2026/' }, fakeFetch);
    const root = document.getElementById('letterboxer-diary').shadowRoot;
    root.getElementById('scan').click();
    await waitFor(() => root.getElementById('status').textContent.startsWith('Comparison complete.'));
    assert(urls.length === 3 && urls[0] === 'https://letterboxd.com/tester/films/');
    assert(root.getElementById('status').textContent.includes('5 diary entries · 2 different · 1 matching · 2 unable'));
    assert(root.querySelectorAll('tbody tr').length === 2, 'Default view must show differences');
    assert(root.querySelector('tbody tr td:nth-child(2)').textContent === '3.5 ★');
    assert(root.querySelector('tbody tr td:nth-child(3)').textContent === '4 ★');
    const filter = root.getElementById('filter');
    filter.value = 'all'; filter.dispatchEvent(new Event('change'));
    assert(root.querySelectorAll('tbody tr').length === 5, 'Both watches and the unreadable entry must remain separate');
    assert(!root.querySelector('tbody a[href*="/film/null/"]'), 'Unreadable films must not create broken film links');
    filter.value = 'unavailable'; filter.dispatchEvent(new Event('change'));
    assert(root.querySelectorAll('tbody tr').length === 2);
    filter.value = 'all'; filter.dispatchEvent(new Event('change'));
    const query = root.getElementById('query'); query.value = 'dune'; query.dispatchEvent(new Event('input'));
    assert(root.querySelectorAll('tbody tr').length === 2);
    document.getElementById('letterboxer-diary').remove();
  });
  await test('Stopping a diary scan keeps partial results labeled incomplete', async () => {
    const source = await (await fetch('../diary.js')).text();
    const filmHTML = grid('<li><div data-film-slug="dune"><img alt="Dune"></div><p class="poster-viewingdata">' + stars(8) + '</p></li>');
    let requests = 0;
    const fakeFetch = async (url) => {
      requests++;
      return new Response(url.includes('/films/') ? filmHTML : diary(diaryRow('1', 'dune', 'Dune', stars(7)), '<a class="next" href="/tester/diary/page/2/">Next</a>'), { headers: { 'content-type': 'text/html' } });
    };
    new Function('location', 'fetch', source)({ pathname: '/tester/' }, fakeFetch);
    const root = document.getElementById('letterboxer-diary').shadowRoot;
    root.getElementById('scan').click();
    await waitFor(() => root.querySelectorAll('tbody tr').length === 1);
    root.getElementById('stop').click();
    await waitFor(() => root.getElementById('status').textContent.startsWith('Loading stopped.'));
    assert(root.getElementById('status').textContent.includes('Comparison incomplete.'));
    assert(requests === 2, 'Stop must prevent the next diary request');
    document.getElementById('letterboxer-diary').remove();
  });
  await test('Histogram parser reads all ten buckets, Unicode half stars and comma-separated counts', () => {
    const summary = Letterboxer.parseRatingHistogram(doc(histogram([1000, 0, 0, 0, 0, 0, 0, 1000, 0, 0])), 'tester');
    assert(summary.count === 2000 && summary.average === 2.25);
    assert(Letterboxer.parseRatingHistogram(doc(histogram(Array(10).fill(0))), 'tester').average === null);
  });
  await test('Histogram tooltip counts are supported; duplicate accessible charts are not double-counted', () => {
    const bars = `<ul class="rating-histogram">${Array.from({ length: 10 }, (_, i) => `<li><a href="/tester/films/rated/${(i + 1) / 2}/" title="${i === 9 ? '2' : '0'} films rated ${(i + 1) / 2} stars"><span style="height:20px"></span></a></li>`).join('')}</ul>`;
    const summary = Letterboxer.parseRatingHistogram(doc(bars + histogram([0, 0, 0, 0, 0, 0, 0, 0, 0, 2])), 'tester');
    assert(summary.count === 2 && summary.average === 5);
  });
  await test('Incomplete, approximate, conflicting and other-member histograms never produce an average', () => {
    const complete = histogram(Array(10).fill(1));
    assert(Letterboxer.parseRatingHistogram(doc(histogram([1, 2, 3])), 'tester') === null);
    assert(Letterboxer.parseRatingHistogram(doc(complete.replaceAll('/tester/', '/someoneelse/')), 'tester') === null);
    rejects(() => Letterboxer.parseRatingHistogram(doc(complete.replace('1 (0%)', '1.2K')), 'tester'));
    rejects(() => Letterboxer.parseRatingHistogram(doc(complete + histogram(Array(10).fill(2))), 'tester'));
  });
  await test('Profile average appears from the existing histogram without requesting any films', async () => {
    const source = await (await fetch('../average.js')).text();
    const chart = document.createElement('div');
    chart.innerHTML = histogram([1, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    document.getElementById('content').append(chart);
    let requests = 0;
    new Function('location', 'fetch', source)({ pathname: '/tester/' }, async () => { requests++; throw new Error('Unexpected request'); });
    const root = document.getElementById('letterboxer-average').shadowRoot;
    assert(root.getElementById('value').textContent === '2.25 / 5 ★');
    assert(root.getElementById('status').textContent.includes('2 rated films'));
    assert(requests === 0);
    document.getElementById('letterboxer-average').remove(); chart.remove();
  });
  await test('Average from a Films page requests just the profile, never film pages', async () => {
    const source = await (await fetch('../average.js')).text();
    const urls = [];
    new Function('location', 'fetch', source)({ pathname: '/tester/films/' }, async (url) => {
      urls.push(url);
      return new Response(histogram([1, 0, 0, 0, 0, 0, 0, 1, 0, 0]), { headers: { 'content-type': 'text/html' } });
    });
    const root = document.getElementById('letterboxer-average').shadowRoot;
    root.getElementById('load').click();
    await waitFor(() => !root.getElementById('value').hidden);
    assert(root.getElementById('value').textContent === '2.25 / 5 ★');
    assert(urls.length === 1 && urls[0] === 'https://letterboxd.com/tester/');
    document.getElementById('letterboxer-average').remove();
  });
  await test('Profile average handles a histogram that loads after page initialization', async () => {
    const source = await (await fetch('../average.js')).text();
    new Function('location', 'fetch', source)({ pathname: '/tester/' }, async () => { throw new Error('Unexpected request'); });
    const root = document.getElementById('letterboxer-average').shadowRoot;
    assert(root.getElementById('value').hidden);
    const chart = document.createElement('div');
    chart.innerHTML = histogram([0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
    document.getElementById('content').append(chart);
    await waitFor(() => !root.getElementById('value').hidden);
    assert(root.getElementById('value').textContent === '5.00 / 5 ★');
    document.getElementById('letterboxer-average').remove(); chart.remove();
  });
  document.title = `${failed ? 'FAIL' : 'PASS'} — Letterboxer tests`;
  report.textContent = `${passed} passed, ${failed} failed\n\n${lines.join('\n')}`;
  document.body.dataset.testResult = failed ? 'fail' : 'pass';
})();
