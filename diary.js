(() => {
  "use strict";
  const member = location.pathname.match(/^\/([a-z0-9_]+)\/(?:(?:films|diary)(?:\/.*)?|)$/i)?.[1];
  if (!member || document.getElementById("letterboxer-diary")) return;
  const filmsLink = [...document.querySelectorAll(".profile-navigation a, .profile-nav a, nav a")]
    .find((a) => a.pathname.toLowerCase() === `/${member.toLowerCase()}/films/`);
  const main = document.querySelector("#content .content-wrap, #content, main");
  if (!filmsLink || !main) return;
  const core = globalThis.Letterboxer;
  const host = document.createElement("section");
  host.id = "letterboxer-diary";
  host.style.cssText = "display:block;clear:both;width:100%;margin:20px 0 28px;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { color-scheme:dark; font:14px/1.5 system-ui,-apple-system,sans-serif; color:#dce3eb; }
      * { box-sizing:border-box; }
      section { background:#1b222b; border:1px solid #394553; border-radius:10px; padding:20px; }
      .top,.controls,.filters { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .top { justify-content:space-between; }
      h2 { font-size:17px; margin:0; font-weight:650; }
      .brand { font-size:10px; color:#9aaaba; text-transform:uppercase; letter-spacing:1.6px; }
      p { color:#a9b8c8; font-size:12px; }
      button,select,input { border:1px solid #506175; border-radius:5px; padding:8px 12px; background:#293543; color:#edf3fa; font:inherit; font-size:12px; }
      button,select { cursor:pointer; }
      button:hover { background:#36465a; }
      button.primary { background:#00c86a; color:#052517; border-color:#00c86a; font-weight:700; }
      input { background:#10161e; width:100%; }
      input:focus-visible,button:focus-visible,a:focus-visible,select:focus-visible { outline:2px solid #00e175; outline-offset:3px; }
      .filters { margin-top:16px; align-items:flex-end; }
      label { display:block; font-size:12px; color:#a9b8c8; }
      label span { display:block; margin-bottom:5px; }
      .query { flex:1; min-width:160px; }
      #status.error { color:#ffb4a7; }
      .table-wrap { overflow:auto; max-height:460px; margin-top:14px; }
      table { width:100%; border-collapse:collapse; text-align:left; font-size:13px; }
      caption { text-align:left; color:#a9b8c8; font-size:12px; padding-bottom:8px; }
      th { font-weight:500; color:#a9b8c8; font-size:11px; }
      th,td { padding:10px 8px; border-bottom:1px solid #34404e; }
      th:first-child,td:first-child { padding-left:0; }
      td:first-child { min-width:160px; }
      td:not(:first-child) { white-space:nowrap; }
      a { color:#edf3fa; text-decoration:none; }
      a:hover { color:#00e175; }
      .date { display:block; color:#97a8ba; font-size:11px; margin-top:3px; }
      .different { color:#ffce87; }
      .match { color:#8de4b5; }
      .unavailable { color:#a9b8c8; }
      #more { margin-top:12px; }
      [hidden] { display:none !important; }
      @media(max-width:500px) { section { padding:14px; } }
    </style>
    <section aria-labelledby="heading">
      <div class="top"><h2 id="heading">Compare diary ratings</h2><span class="brand">Letterboxer</span></div>
      <p>Compare every diary entry with this member’s current rating in Films. Rewatches are checked separately. Different ratings can reflect a change of opinion.</p>
      <div class="controls"><button id="scan" class="primary">Compare ratings</button><button id="stop" hidden>Stop</button></div>
      <p id="status" role="status" aria-live="polite">Loads fresh film ratings and the full diary when you start. Nothing is changed on Letterboxd.</p>
      <div id="filters" class="filters" hidden>
        <label><span>Show entries</span><select id="filter"><option value="different">Different ratings</option><option value="all">All diary entries</option><option value="match">Matching ratings</option><option value="unavailable">Unable to compare</option></select></label>
        <label class="query"><span>Search title</span><input id="query" type="search" placeholder="Filter diary results…" maxlength="200"></label>
      </div>
      <div id="table-wrap" class="table-wrap" hidden><table><caption id="caption"></caption><thead><tr><th scope="col">Film / diary entry</th><th scope="col">Diary rating</th><th scope="col">Films rating</th><th scope="col">Comparison</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p id="empty" hidden></p><button id="more" hidden>Show more entries</button>
    </section>`;
  const search = document.getElementById("letterboxer-search");
  if (search) search.after(host);
  else main.prepend(host);
  const $ = (id) => root.getElementById(id);
  let films = [], entries = [], loading = false, complete = false, error = "", stage = "", controller;
  let phasePages = 0, limit = 100;

  function render() {
    const results = core.compareRatings(entries, films);
    const counts = { different: 0, match: 0, unavailable: 0 };
    for (const result of results) counts[result.status]++;
    let shown = results.filter((result) => $("filter").value === "all" || result.status === $("filter").value);
    if ($("query").value.trim()) {
      const words = core.normalize($("query").value).split(/\s+/).filter(Boolean);
      shown = shown.filter((entry) => words.every((word) => core.normalize(entry.title).includes(word)));
    }
    $("rows").replaceChildren(...shown.slice(0, limit).map((entry) => {
      const tr = document.createElement("tr");
      const filmCell = document.createElement("td");
      const filmLink = document.createElement(entry.slug ? "a" : "span");
      filmLink.textContent = entry.title;
      if (entry.slug) filmLink.href = `https://letterboxd.com/film/${encodeURIComponent(entry.slug)}/`;
      const diaryLink = document.createElement("a");
      diaryLink.className = "date"; diaryLink.textContent = `${entry.date} · Diary entry →`; diaryLink.href = entry.url;
      filmCell.append(filmLink, diaryLink);
      const diaryCell = document.createElement("td"); diaryCell.textContent = core.formatRating(entry.rating);
      const currentCell = document.createElement("td"); currentCell.textContent = core.formatRating(entry.currentRating);
      const statusCell = document.createElement("td"); statusCell.className = entry.status;
      statusCell.textContent = { different: "Different", match: "Matches", unavailable: "Unable to compare" }[entry.status];
      if (entry.unavailableReason) statusCell.title = entry.unavailableReason;
      tr.append(filmCell, diaryCell, currentCell, statusCell);
      return tr;
    }));
    $("scan").hidden = loading;
    $("scan").textContent = complete ? "Compare again" : entries.length || error ? "Restart comparison" : "Compare ratings";
    $("stop").hidden = !loading;
    $("filters").hidden = !entries.length;
    $("table-wrap").hidden = !shown.length;
    $("caption").textContent = `${Math.min(limit, shown.length)} of ${shown.length} entries${complete ? "" : " · Partial results"}`;
    $("more").hidden = shown.length <= limit;
    $("empty").hidden = !entries.length || shown.length > 0;
    $("empty").textContent = complete ? "No entries match these filters." : "No entries match these filters so far. The comparison is incomplete.";
    const summary = `${entries.length.toLocaleString()} diary entries · ${counts.different} different · ${counts.match} matching · ${counts.unavailable} unable to compare.`;
    let message = loading ? `${stage === "films" ? "Loading current Films ratings" : "Loading diary"} · page ${phasePages + 1}. ${stage === "films" ? `${films.length} films loaded.` : summary} Results are partial.`
      : complete ? `Comparison complete. ${summary}${counts.unavailable ? " Select Unable to compare to inspect entries that could not be checked." : ""}`
      : entries.length ? `Comparison incomplete. ${summary}`
      : "Loads fresh film ratings and the full diary when you start. Nothing is changed on Letterboxd.";
    if (error) message = `${error} Comparison incomplete.${entries.length ? ` ${summary}` : ""}`;
    $("status").textContent = message;
    $("status").classList.toggle("error", Boolean(error));
  }

  async function start() {
    if (loading) return;
    loading = true; complete = false; error = ""; films = []; entries = []; limit = 100;
    stage = "films"; phasePages = 0; controller = new AbortController(); render();
    const shared = { member, signal: controller.signal,
      fetchPage: (url, signal) => core.fetchDocument(url, signal, fetch) };
    try {
      films = await core.crawl({ ...shared, parse: (doc, name, page) => core.parsePage(doc, name, page, { includeRatings: true }),
        onProgress(progress) { films = progress.films; phasePages = progress.pages; render(); } });
      controller.signal.throwIfAborted();
      stage = "diary"; phasePages = 0; render();
      entries = await core.crawl({ ...shared, collection: "diary", key: (entry) => entry.id, parse: core.parseDiaryPage,
        onProgress(progress) { entries = progress.films; phasePages = progress.pages; render(); } });
      controller.signal.throwIfAborted();
      complete = true;
    } catch (err) {
      error = controller.signal.aborted ? "Loading stopped." : err.name === "TimeoutError" ? "Letterboxd took too long to respond. Try again." : err.message || "Couldn’t compare ratings.";
    } finally { loading = false; render(); }
  }
  $("scan").addEventListener("click", start);
  $("stop").addEventListener("click", () => controller?.abort());
  $("filter").addEventListener("change", () => { limit = 100; render(); });
  $("query").addEventListener("input", () => { limit = 100; render(); });
  $("more").addEventListener("click", () => { limit += 100; render(); });
  window.addEventListener("pagehide", () => controller?.abort(), { once: true });
})();
