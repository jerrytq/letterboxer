(() => {
  "use strict";
  const member = location.pathname.match(/^\/([a-z0-9_]+)\/(?:(?:films|diary)(?:\/.*)?|)$/i)?.[1];
  if (!member || document.getElementById("letterboxer-search")) return;
  // Confirm this is a member page, rather than a similarly shaped site route.
  const filmsLink = [...document.querySelectorAll(".profile-navigation a, .profile-nav a, nav a")]
    .find((a) => a.pathname.toLowerCase() === `/${member.toLowerCase()}/films/`);
  if (!filmsLink) return;
  const main = document.querySelector("#content .content-wrap, #content, main");
  if (!main) return;

  const core = globalThis.Letterboxer;
  const cacheKey = `letterboxer:v1:${member.toLowerCase()}`;
  const ttl = 6 * 60 * 60 * 1000;
  const host = document.createElement("section");
  host.id = "letterboxer-search";
  host.style.cssText = "display:block;clear:both;width:100%;margin:20px 0 28px;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { color-scheme:dark; font:14px/1.5 system-ui,-apple-system,sans-serif; color:#dce3eb; }
      * { box-sizing:border-box; }
      section { background:#1b222b; border:1px solid #394553; border-radius:10px; padding:20px; }
      .top,.controls,.summary { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .top { justify-content:space-between; margin-bottom:14px; }
      h2 { font-size:17px; margin:0; font-weight:650; letter-spacing:0; }
      .brand { font-size:10px; color:#9aaaba; text-transform:uppercase; letter-spacing:1.6px; }
      label { display:block; margin-bottom:7px; color:#a9b8c8; font-size:12px; }
      input { width:100%; min-width:0; background:#10161e; color:#fff; border:1px solid #506175; border-radius:6px; padding:11px 12px; font:inherit; }
      input:focus-visible,button:focus-visible,a:focus-visible { outline:2px solid #00e175; outline-offset:3px; }
      .field { flex:1; min-width:180px; }
      button { cursor:pointer; border:1px solid #506175; border-radius:5px; padding:8px 12px; background:#293543; color:#edf3fa; font:inherit; font-size:12px; }
      button:hover { background:#36465a; }
      button:disabled { opacity:.5; cursor:default; }
      button.primary { background:#00c86a; color:#052517; border-color:#00c86a; font-weight:700; }
      .summary { justify-content:space-between; margin-top:12px; color:#a9b8c8; font-size:12px; }
      #status { flex:1; min-width:180px; margin:0; }
      #status.error { color:#ffb4a7; }
      .actions { display:flex; gap:6px; }
      #results { margin:14px 0 0; padding:0; list-style:none; max-height:420px; overflow:auto; }
      li { border-top:1px solid #34404e; }
      li a { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 2px; color:#edf3fa; text-decoration:none; }
      li a:hover { color:#00e175; }
      .film-info { min-width:0; }
      .year { color:#97a8ba; font-size:12px; margin-left:8px; white-space:nowrap; }
      .rating { color:#00e175; white-space:nowrap; flex-shrink:0; }
      .rating.muted { color:#97a8ba; font-size:12px; }
      #empty,#more { color:#a9b8c8; font-size:13px; margin:14px 0 0; }
      [hidden] { display:none !important; }
      @media(max-width:500px) { section { padding:14px; } .controls { align-items:stretch; } }
    </style>
    <section aria-labelledby="heading">
      <div class="top"><h2 id="heading">Search watched films</h2><span class="brand">Letterboxer</span></div>
      <label for="query">Search this member’s entire watched collection by title or year</label>
      <div class="controls"><div class="field"><input id="query" type="search" placeholder="Try Dune or 2024…" autocomplete="off" maxlength="200"></div><button class="primary" id="load">Load films</button></div>
      <div class="summary"><p id="status" role="status" aria-live="polite">Start typing or load films to build a searchable collection.</p><div class="actions"><button id="stop" hidden>Stop</button><button id="refresh" hidden>Refresh</button><button id="clear" hidden>Clear cache</button></div></div>
      <ul id="results" aria-label="Matching watched films"></ul><p id="empty" hidden></p><p id="more" hidden></p>
    </section>`;
  const navigation = document.querySelector(".profile-navigation, .profile-nav");
  if (navigation && main.contains(navigation)) navigation.after(host);
  else main.prepend(host);
  const $ = (id) => root.getElementById(id);
  let films = [], loading = false, complete = false, controller, pages = 0, savedAt = 0, error = "", cacheWarning = "";

  function render() {
    const query = $("query").value.trim();
    const matches = core.search(films, query);
    $("results").replaceChildren(...matches.slice(0, 100).map((film) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `https://letterboxd.com/film/${encodeURIComponent(film.slug)}/`;
      const title = document.createElement("span");
      title.textContent = film.title;
      const info = document.createElement("span");
      info.className = "film-info";
      const year = document.createElement("span");
      year.className = "year";
      year.textContent = film.year || "";
      info.append(title, year);
      const rating = document.createElement("span");
      const rated = Number.isInteger(film.rating) && film.rating >= 1 && film.rating <= 10;
      rating.className = rated ? "rating" : "rating muted";
      rating.textContent = rated ? "★".repeat(Math.floor(film.rating / 2)) + (film.rating % 2 ? "½" : "") : core.formatRating(film.rating);
      if (rated) {
        rating.setAttribute("role", "img");
        rating.setAttribute("aria-label", `Member’s rating: ${film.rating / 2} out of 5 stars`);
      }
      link.append(info, rating);
      li.append(link);
      return li;
    }));
    $("load").hidden = loading || complete;
    $("load").textContent = films.length ? "Reload films" : "Load films";
    $("stop").hidden = !loading;
    $("refresh").hidden = loading || !complete;
    $("clear").hidden = loading || (!films.length && !complete);
    const count = `${films.length.toLocaleString()} films`;
    let message = loading ? `Loading page ${pages + 1} · ${count} searchable so far. Results are partial.`
      : complete ? `${count} · ${query ? `${matches.length.toLocaleString()} matches · ` : ""}Updated ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
      : films.length ? `${count} loaded. Results are incomplete; reload to search the full collection.`
      : "Start typing or load films to build a searchable collection.";
    if (error) message = `${error}${films.length ? " Results are incomplete." : ""}`;
    $("status").textContent = message + (cacheWarning ? ` ${cacheWarning}` : "");
    $("status").classList.toggle("error", Boolean(error));
    $("empty").hidden = !query || matches.length > 0;
    $("empty").textContent = complete ? "No watched films match this search." : "No matches in the films loaded so far.";
    $("more").hidden = matches.length <= 100;
    $("more").textContent = `Showing the first 100 of ${matches.length} matches. Add more words to narrow your search.`;
  }

  async function fetchPage(url, signal) {
    return core.fetchDocument(url, signal, fetch);
  }

  async function start() {
    await ready;
    if (loading) return;
    loading = true; complete = false; error = ""; cacheWarning = ""; films = []; pages = 0;
    controller = new AbortController();
    render();
    try {
      films = await core.crawl({ member, fetchPage,
        parse: (doc, name, page) => core.parsePage(doc, name, page, { includeRatings: true }), signal: controller.signal,
        onProgress(progress) { films = progress.films; pages = progress.pages; render(); }
      });
      complete = true; savedAt = Date.now();
      try {
        // Bound total storage without requiring the unlimitedStorage permission.
        const all = await chrome.storage.local.get(null);
        const old = Object.entries(all).filter(([key]) => key.startsWith("letterboxer:v1:") && key !== cacheKey)
          .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
        await chrome.storage.local.remove(old.slice(4).map(([key]) => key));
        // Preserve unknown ratings explicitly; JSON storage must not turn them into unrated values.
        const cachedFilms = films.map((film) => ({ ...film, rating: film.rating === undefined ? "unavailable" : film.rating }));
        await chrome.storage.local.set({ [cacheKey]: { schema: 2, films: cachedFilms, savedAt, complete: true } });
      } catch { cacheWarning = "Couldn’t save a local cache; search still works in this tab."; }
    } catch (err) {
      error = controller.signal.aborted ? "Loading stopped." : err.name === "TimeoutError" ? "Letterboxd took too long to respond. Try again." : err.message || "Couldn’t load films. Try again.";
    } finally { loading = false; render(); }
  }

  const ready = (async () => {
    try {
      const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
      if (cached?.schema === 2 && cached.complete && Date.now() - cached.savedAt < ttl && Array.isArray(cached.films) &&
          cached.films.every((film) => /^[a-z0-9-]+$/.test(film.slug) && typeof film.title === "string" &&
            (film.rating === null || film.rating === "unavailable" || (Number.isInteger(film.rating) && film.rating >= 1 && film.rating <= 10)))) {
        films = cached.films; complete = true; savedAt = cached.savedAt;
      } else if (cached) await chrome.storage.local.remove(cacheKey);
    } catch { cacheWarning = "Local cache is unavailable."; }
    render();
  })();
  $("load").addEventListener("click", start);
  $("refresh").addEventListener("click", start);
  $("stop").addEventListener("click", () => controller?.abort());
  $("clear").addEventListener("click", async () => {
    clearTimeout(debounce);
    try { await chrome.storage.local.remove(cacheKey); }
    catch { error = "Couldn’t clear the local cache. Try reloading the extension."; render(); return; }
    films = []; complete = false; savedAt = 0; error = ""; cacheWarning = ""; render();
  });
  let debounce;
  $("query").addEventListener("input", () => {
    render();
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      await ready;
      if ($("query").value.trim() && !complete && !loading && !error) start();
    }, 350);
  });
  window.addEventListener("pagehide", () => controller?.abort(), { once: true });
})();
