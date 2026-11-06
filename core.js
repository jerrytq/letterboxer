/* Shared parsing and indexing logic. No network requests until a search starts. */
(() => {
  "use strict";

  const normalize = (value) => String(value).normalize("NFKD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function search(films, query) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return films.filter((film) => {
      const title = normalize(`${film.title} ${film.year || ""}`);
      return words.every((word) => title.includes(word));
    }).sort((a, b) => a.title.localeCompare(b.title) || String(a.year).localeCompare(String(b.year)));
  }

  function collectionURL(member, page = 1, collection = "films") {
    if (!["films", "diary"].includes(collection)) throw new Error("Unsupported collection.");
    return `https://letterboxd.com/${encodeURIComponent(member)}/${collection}/${page > 1 ? `page/${page}/` : ""}`;
  }

  function pageNumber(value, member, collection = "films") {
    const url = new URL(value, collectionURL(member));
    if (url.origin !== "https://letterboxd.com" || url.search || url.hash) throw new Error("Unexpected pagination link. Loading stopped.");
    const parts = url.pathname.split("/").filter(Boolean);
    // The current diary's Films tab paginates under /diary/films/page/N/.
    if (collection === "diary" && parts[1] === "diary" && parts[2] === "films") parts.splice(2, 1);
    if (parts[0]?.toLowerCase() !== member.toLowerCase() || parts[1] !== collection ||
        !(parts.length === 2 || (parts.length === 4 && parts[2] === "page" && /^[1-9]\d*$/.test(parts[3])))) {
      throw new Error("Unexpected pagination link. Loading stopped.");
    }
    return parts.length === 2 ? 1 : Number(parts[3]);
  }

  function slugFrom(node) {
    const candidates = [node, ...node.querySelectorAll("[data-film-slug], [data-item-slug], [data-target-link], [data-item-link], a[href*='/film/']")];
    for (const candidate of candidates) {
      const explicit = candidate.getAttribute("data-film-slug") || candidate.getAttribute("data-item-slug");
      if (explicit && /^[a-z0-9][a-z0-9-]*$/.test(explicit)) return explicit;
      const links = [explicit, candidate.getAttribute("data-target-link"), candidate.getAttribute("data-item-link"), candidate.getAttribute("href")];
      for (const link of links.filter(Boolean)) {
        try {
          const url = new URL(link, "https://letterboxd.com");
          const slug = url.origin === "https://letterboxd.com" ? url.pathname.match(/^\/(?:[a-z0-9_]+\/)?film\/([a-z0-9-]+)(?:\/|$)/i)?.[1] : null;
          if (slug) return slug;
        } catch { /* A malformed optional link must not hide valid nested metadata. */ }
      }
    }
    return null;
  }

  function checkChallenge(doc) {
    if (doc.querySelector('#challenge-form, #cf-challenge-running') || /just a moment|attention required/i.test(doc.title)) {
      throw new Error("Letterboxd asked for a browser check. Open the member’s page, complete the check, then try again.");
    }
  }

  // Half-star units: 1 = ½ star, 10 = 5 stars. null = unrated; undefined = unreadable.
  function readRating(scope) {
    const selector = ".rating, [class*='rated-']";
    const marker = [scope, ...scope.querySelectorAll(selector)].find((node) =>
      node.matches(selector) && !node.closest(".average-rating, .your-rating, .rating-average"));
    if (!marker) return null;
    const match = marker.className.match(/(?:^|\s)rated-(\d+)(?:\s|$)/);
    if (match) {
      const value = Number(match[1]);
      return value >= 1 && value <= 10 ? value : value === 0 ? null : undefined;
    }
    const text = marker.textContent.replace(/\s/g, "");
    if (/^★{0,5}½?$/.test(text) && text) {
      const value = (text.match(/★/g) || []).length * 2 + (text.includes("½") ? 1 : 0);
      return value >= 1 && value <= 10 ? value : undefined;
    }
    return undefined;
  }

  function nextPageNumber(content, member, page, collection = "films") {
    const next = content.querySelector("a.next, a.paginate-next, .pagination a[rel='next']");
    if (next) {
      const nextPage = pageNumber(next.getAttribute("href"), member, collection);
      if (nextPage !== page + 1) throw new Error("Unexpected page order. Loading stopped to avoid missing entries.");
      return nextPage;
    }
    const hasLaterPage = [...content.querySelectorAll(".pagination a[href], .paginate-pages a[href]")].some((a) => {
      try { return pageNumber(a.getAttribute("href"), member, collection) > page; } catch { return false; }
    });
    if (hasLaterPage) throw new Error("The next-page link could not be read. Loading stopped to avoid incomplete results.");
    return null;
  }

  function parsePage(doc, member, page, { includeRatings = false } = {}) {
    checkChallenge(doc);
    const content = doc.querySelector("#content, main") || doc.body;
    const grids = [...content.querySelectorAll(".poster-list, .poster-grid, ul.grid")];
    const nodes = grids.flatMap((grid) => [...grid.querySelectorAll("[data-film-slug], [data-item-slug], [data-target-link*='/film/']")]);
    const films = new Map();
    for (const node of nodes) {
      const slug = slugFrom(node);
      if (!slug) continue;
      const image = node.querySelector("img");
      let title = node.getAttribute("data-film-name") || node.getAttribute("data-item-name") || image?.getAttribute("alt") || "";
      let year = node.getAttribute("data-film-release-year") || node.getAttribute("data-item-year") || "";
      const suffix = title.match(/\s+\((\d{4})\)$/);
      if (suffix) {
        year ||= suffix[1];
        title = title.slice(0, suffix.index);
      }
      title = title.trim();
      if (!title) throw new Error("A film title could not be read. Letterboxd’s layout may have changed.");
      const film = { slug, title, year: /^\d{4}$/.test(year) ? year : "" };
      if (includeRatings) {
        const item = node.closest("li");
        // Never substitute a site-wide average or the viewer's rating for this member's.
        const scope = item?.querySelector(".poster-viewingdata") || item;
        film.rating = scope ? readRating(scope) : undefined;
      }
      films.set(slug, film);
    }
    const nextPage = nextPageNumber(content, member, page);
    if (!films.size) {
      const empty = /(?:hasn[’']t|haven[’']t|has not|have not) (?:watched|logged)|no films|no matching films/i.test(content.textContent);
      if (page !== 1 || nextPage || !empty) throw new Error("Couldn’t read the watched films. Open the Films page to check access, then try again.");
    }
    // Recognizing a grid but skipping some of its posters must not look like a complete index.
    const posterCount = grids.reduce((count, grid) => count + [...grid.children].filter((child) => child.tagName === "LI").length, 0);
    if (posterCount > films.size) throw new Error("Some film posters could not be read. Letterboxd’s layout may have changed.");
    return { films: [...films.values()], nextPage };
  }

  function parseDiaryPage(doc, member, page) {
    checkChallenge(doc);
    const content = doc.querySelector("#content, main") || doc.body;
    const rows = [...content.querySelectorAll("tr.diary-entry-row, #diary-table tbody tr")]
      .filter((row) => row.matches(".diary-entry-row") || row.querySelector(".td-film-details, .col-production"));
    let month = "", year = "";
    const entries = rows.map((row, index) => {
      const slug = slugFrom(row);
      const details = row.querySelector(".td-film-details, .col-production") || row;
      const metadata = details.querySelector("[data-film-name], [data-item-name]");
      const title = details.querySelector("h2.primaryname, h2, h3, .headline-3, .film-title")?.textContent.trim() ||
        metadata?.getAttribute("data-film-name") || metadata?.getAttribute("data-item-name") ||
        details.querySelector("a[href*='/film/']")?.textContent.trim() ||
        details.querySelector("img[alt]")?.getAttribute("alt")?.trim() || "Film title unavailable";
      month = row.querySelector(".td-calendar .month, .col-monthdate .month")?.textContent.trim() || month;
      year = row.querySelector(".td-calendar .year, .col-monthdate .year")?.textContent.trim() || year;
      const day = row.querySelector(".td-day, .col-daydate")?.textContent.trim() || "";
      const dayLink = row.querySelector(".td-day a[href], .col-daydate a[href]")?.getAttribute("href") || "";
      const dateParts = dayLink.match(/\/for\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
      const date = row.querySelector("time[datetime]")?.getAttribute("datetime") ||
        (dateParts ? `${dateParts[1]}-${dateParts[2].padStart(2, "0")}-${dateParts[3].padStart(2, "0")}` : [day, month, year].filter(Boolean).join(" "));
      const reviewHref = row.querySelector(".td-review a[href*='/film/'], .col-review a[href*='/film/']")?.getAttribute("href");
      let entryURL = null;
      if (reviewHref && slug) {
        try {
          const url = new URL(reviewHref, collectionURL(member));
          const prefix = `/${member.toLowerCase()}/film/${slug}/`;
          if (url.origin === "https://letterboxd.com" && url.pathname.toLowerCase().startsWith(prefix)) entryURL = url.href;
        } catch { /* Use the diary page when an entry link is malformed. */ }
      }
      const id = row.getAttribute("data-viewing-id") || row.id || entryURL || `page-${page}-row-${index}`;
      const ratingCell = row.querySelector(".td-rating, .col-rating");
      let diaryURL = collectionURL(member, page, "diary");
      if (row.querySelector(".col-production") && page > 1) diaryURL = diaryURL.replace("/diary/", "/diary/films/");
      if (dayLink) {
        try {
          const url = new URL(dayLink, diaryURL);
          if (url.origin === "https://letterboxd.com" && url.pathname.toLowerCase().startsWith(`/${member.toLowerCase()}/diary/`) && /\/for\/\d{4}\/\d{1,2}\/\d{1,2}\/$/.test(url.pathname)) diaryURL = url.href;
        } catch { /* Retain the diary page if the date link cannot be read. */ }
      }
      return { id, slug, title, date: date || "Date unavailable", rating: ratingCell ? readRating(ratingCell) : undefined,
        unavailableReason: slug ? "" : "Film identity could not be read from this diary entry.",
        url: entryURL || diaryURL };
    });
    const nextPage = nextPageNumber(content, member, page, "diary");
    if (!entries.length && (page !== 1 || nextPage || !/(?:hasn[’']t|haven[’']t|has not|have not) (?:logged|added)|no (?:diary entries|entries|films)|diary is empty/i.test(content.textContent))) {
      throw new Error("Couldn’t read the diary. Open the member’s Diary page to check access, then try again.");
    }
    const nextLink = content.querySelector("a.next, a.paginate-next, .pagination a[rel='next']");
    const nextURL = nextPage ? new URL(nextLink.getAttribute("href"), collectionURL(member)).href : null;
    return { films: entries, nextPage, nextURL };
  }

  function compareRatings(entries, films) {
    const bySlug = new Map(films.map((film) => [film.slug, film]));
    return entries.map((entry) => {
      const film = bySlug.get(entry.slug);
      const currentRating = film?.rating;
      const known = (rating) => rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 10);
      const status = !film || !known(entry.rating) || !known(currentRating) ? "unavailable"
        : entry.rating === currentRating ? "match" : "different";
      return { ...entry, currentRating, status };
    });
  }

  function formatRating(rating) {
    if (rating === null) return "Unrated";
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) return "Unavailable";
    return `${rating / 2} ★`;
  }

  function averageFromHistogram(bins) {
    if (!Array.isArray(bins) || bins.length !== 10 || bins.some((count) => !Number.isSafeInteger(count) || count < 0)) {
      throw new Error("The rating histogram must contain ten exact counts, from half a star to five stars.");
    }
    const count = bins.reduce((sum, value) => sum + value, 0);
    const weightedTotal = bins.reduce((sum, value, index) => sum + value * (index + 1), 0);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(weightedTotal)) throw new Error("Rating counts are too large to calculate accurately.");
    return { count, average: count ? weightedTotal / (2 * count) : null };
  }

  function parseRatingHistogram(doc, member) {
    checkChallenge(doc);
    const charts = new Set(doc.querySelectorAll(".rating-histogram, #rating-histogram, .ratings-histogram, .rating-histogram-chart, .ratings-histogram-chart, .histogram"));
    for (const table of doc.querySelectorAll("table")) {
      if (/rating distribution/i.test(table.querySelector("caption")?.textContent || "")) charts.add(table);
    }
    if (!charts.size) return null;
    const bins = new Map();
    for (const chart of charts) {
      for (const link of chart.querySelectorAll("a[href]")) {
        const url = new URL(link.getAttribute("href"), collectionURL(member));
        if (url.origin !== "https://letterboxd.com" || url.search || url.hash) continue;
        const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
        if (parts.shift()?.toLowerCase() !== member.toLowerCase() || parts.shift() !== "films") continue;
        if (parts[0] === "ratings") parts.shift();
        if (parts.shift() !== "rated") continue;
        const score = parts.shift();
        if (parts.length && parts.join("/") !== "by/date") continue;
        const value = score === "½" ? 0.5 : /^\d½$/.test(score) ? Number(score[0]) + 0.5 : Number(score);
        const bucket = value * 2;
        if (!Number.isInteger(bucket) || bucket < 1 || bucket > 10) continue;
        const cell = link.closest("td");
        const sources = [link.getAttribute("data-count"), link.textContent, cell?.textContent,
          link.getAttribute("title"), link.getAttribute("data-original-title"), link.getAttribute("aria-label")];
        let count;
        for (const source of sources) {
          if (!source) continue;
          const text = source.replace(/[\u00a0\u202f]/g, " ").trim();
          const match = text.match(/^([\d, ]+)(?:\s*\(\d+(?:\.\d+)?%\))?$/) || text.match(/(?:^|[^\d.])([\d][\d, ]*)\s+(?:films?|ratings?)\b/i);
          if (match) {
            const number = Number(match[1].replace(/[, ]/g, ""));
            if (Number.isSafeInteger(number) && number >= 0) { count = number; break; }
          }
        }
        if (count === undefined) throw new Error("An exact rating count could not be read from the histogram.");
        if (bins.has(bucket) && bins.get(bucket) !== count) throw new Error("The histogram contains conflicting rating counts.");
        bins.set(bucket, count);
      }
    }
    // Missing bins must never silently become zero or produce an average from a partial graph.
    if (bins.size !== 10) return null;
    return averageFromHistogram(Array.from({ length: 10 }, (_, index) => bins.get(index + 1)));
  }

  async function fetchDocument(url, signal, fetchImpl = fetch) {
    const timeout = AbortSignal.timeout(25000);
    const combined = new AbortController();
    const stop = () => combined.abort(signal.aborted ? signal.reason : timeout.reason);
    signal.addEventListener("abort", stop, { once: true });
    timeout.addEventListener("abort", stop, { once: true });
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(url, { credentials: "same-origin", cache: "no-store", signal: combined.signal, redirect: "error" });
      if (response.status === 429) throw new Error("Letterboxd is limiting requests. Wait a few minutes before trying again.");
      if (!response.ok) throw new Error(`Letterboxd returned ${response.status}. Open the member’s page and try again.`);
      if (!(response.headers.get("content-type") || "").includes("text/html")) throw new Error("Letterboxd returned an unexpected response.");
      return new DOMParser().parseFromString(await response.text(), "text/html");
    } finally {
      signal.removeEventListener("abort", stop);
      timeout.removeEventListener("abort", stop);
    }
  }

  async function crawl({ member, fetchPage, parse, signal, onProgress = () => {}, delay = 900,
    collection = "films", key = (film) => film.slug }) {
    const films = new Map();
    let page = 1;
    let url = collectionURL(member, page, collection);
    while (page) {
      signal.throwIfAborted();
      if (page > 1000) throw new Error("This collection is too large for this version. Results are incomplete.");
      const result = await fetchPage(url, signal);
      signal.throwIfAborted();
      const parsed = parse(result, member, page);
      if (parsed.nextURL && pageNumber(parsed.nextURL, member, collection) !== parsed.nextPage) {
        throw new Error("Unexpected pagination link. Loading stopped.");
      }
      for (const film of parsed.films) films.set(key(film), film);
      onProgress({ films: [...films.values()], pages: page, complete: !parsed.nextPage });
      page = parsed.nextPage;
      if (page) url = parsed.nextURL || collectionURL(member, page, collection);
      if (page) {
        signal.throwIfAborted();
        await new Promise((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, delay);
          signal.addEventListener("abort", cancel, { once: true });
        });
      }
    }
    return [...films.values()];
  }

  globalThis.Letterboxer = { normalize, search, collectionURL, pageNumber, parsePage, parseDiaryPage,
    readRating, compareRatings, formatRating, averageFromHistogram, parseRatingHistogram, fetchDocument, crawl };
})();
