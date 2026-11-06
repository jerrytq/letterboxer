(() => {
  "use strict";
  const member = location.pathname.match(/^\/([a-z0-9_]+)\/(?:(?:films|diary)(?:\/.*)?|)$/i)?.[1];
  if (!member || document.getElementById("letterboxer-average")) return;
  const filmsLink = [...document.querySelectorAll(".profile-navigation a, .profile-nav a, nav a")]
    .find((a) => a.pathname.toLowerCase() === `/${member.toLowerCase()}/films/`);
  const main = document.querySelector("#content .content-wrap, #content, main");
  if (!filmsLink || !main) return;
  const core = globalThis.Letterboxer;
  const host = document.createElement("section");
  host.id = "letterboxer-average";
  host.style.cssText = "display:block;clear:both;width:100%;margin:20px 0;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { color-scheme:dark; font:13px/1.5 system-ui,-apple-system,sans-serif; color:#dce3eb; }
      section { display:flex; align-items:center; flex-wrap:wrap; gap:12px; background:#1b222b; border:1px solid #394553; border-radius:10px; padding:16px 20px; }
      h2 { font-size:14px; margin:0; font-weight:600; }
      #value { color:#00e175; font-size:22px; font-weight:650; }
      #status { flex:1; min-width:140px; margin:0; color:#a9b8c8; font-size:12px; }
      #status.error { color:#ffb4a7; }
      button { cursor:pointer; border:1px solid #506175; border-radius:5px; padding:8px 12px; background:#293543; color:#edf3fa; font:inherit; font-size:12px; }
      button:disabled { opacity:.5; cursor:default; }
      button:focus-visible { outline:2px solid #00e175; outline-offset:3px; }
      [hidden] { display:none !important; }
    </style>
    <section aria-label="Average member rating">
      <h2>Average rating</h2><span id="value" hidden></span>
      <p id="status" role="status" aria-live="polite">Calculated from the profile’s rating histogram.</p>
      <button id="load">Load average</button>
    </section>`;
  const search = document.getElementById("letterboxer-search");
  if (search) search.before(host);
  else main.prepend(host);
  const $ = (id) => root.getElementById(id);
  let observer, timer, controller, busy = false;
  const onProfile = location.pathname === `/${member}/`;

  function stopWatching() { observer?.disconnect(); clearTimeout(timer); }
  function show(summary) {
    stopWatching();
    $("value").hidden = summary.average === null;
    $("value").textContent = summary.average === null ? "" : `${summary.average.toFixed(2)} / 5 ★`;
    $("status").textContent = summary.count ? `From ${summary.count.toLocaleString()} rated films in the profile histogram. Unrated films excluded.` : "No rated films in the profile histogram yet.";
    $("status").classList.remove("error");
    $("load").textContent = "Refresh average";
  }
  function unavailable(message) {
    stopWatching();
    $("value").hidden = true;
    $("status").textContent = message;
    $("status").classList.add("error");
    $("load").textContent = "Retry average";
  }
  function readCurrent() {
    try {
      const summary = core.parseRatingHistogram(document, member);
      if (!summary) return false;
      show(summary); return true;
    } catch (err) { unavailable(err.message); return true; }
  }
  async function load() {
    if (busy) return;
    stopWatching(); busy = true; $("load").disabled = true;
    $("status").textContent = "Loading the profile’s rating histogram…";
    $("status").classList.remove("error");
    controller = new AbortController();
    try {
      const doc = await core.fetchDocument(`https://letterboxd.com/${encodeURIComponent(member)}/`, controller.signal, fetch);
      const summary = core.parseRatingHistogram(doc, member);
      if (summary) show(summary);
      else unavailable("A complete rating histogram isn’t available. Visit the member’s profile and try again.");
    } catch (err) {
      if (!controller.signal.aborted) unavailable(err.message || "Couldn’t load the rating histogram.");
    } finally { busy = false; $("load").disabled = false; }
  }
  $("load").addEventListener("click", load);
  if (onProfile && !readCurrent()) {
    // Some profile charts appear after the initial document has loaded.
    $("status").textContent = "Waiting for the profile’s rating histogram…";
    observer = new MutationObserver(() => readCurrent());
    observer.observe(main, { childList: true, subtree: true, attributes: true, characterData: true });
    timer = setTimeout(() => unavailable("A complete rating histogram isn’t available on this profile."), 10000);
  }
  window.addEventListener("pagehide", () => { stopWatching(); controller?.abort(); }, { once: true });
})();
