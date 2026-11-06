# Letterboxer

A small, dependency-free Chrome extension that adds watched-film search, diary rating comparisons and average member ratings to Letterboxd member profiles, Films and Diary pages.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select `C:\Users\jerry\letterboxer` (the folder containing `manifest.json`).
4. Open or reload someone's Letterboxd profile or Films page.
5. Type a film title in **Search watched films**, or click **Load films**.

The first search fetches the full watched collection, one page at a time, with a pause between requests. Partial results appear immediately. Keep the tab open until loading finishes. A member with thousands of films may take a few minutes.

Search ignores case, accents and punctuation, supports partial titles, and matches all entered words in any order. You can also search by year when Letterboxd includes it in the poster metadata. Each result shows the member's Films rating as stars, including half stars, or **Unrated**. An unreadable rating is labeled **Unavailable**. Click a result to visit the main Letterboxd film page.

## Average member rating

**Average rating** calculates a weighted mean from the ten buckets in the profile's rating distribution: `sum(stars × count) / sum(count)`. It includes every half-star increment and excludes unrated films. This is the average of the member's film ratings, rather than their diary entries or the site's average ratings for those films.

On a member's profile, it reads the existing histogram automatically, including charts that load shortly after the page. On Films or Diary pages, click **Load average** to fetch just the member's profile. It never loads film pages to calculate the average. The result shows two decimal places and the total number of rated films.

**Refresh average** reloads the profile histogram. Missing or incomplete histograms do not produce a guessed average. An empty histogram shows **No rated films**. The average and histogram are not saved in extension storage.

## Compare diary ratings

Click **Compare ratings** in the **Compare diary ratings** panel. It loads fresh member ratings from every Films page, then every diary page, and compares entries by film identity. It does not use the cached title search data, the site's average rating, or your own rating of someone else's film.

The table shows each diary entry's rating alongside the member's current Films rating. Rewatches remain separate entries, even for the same film. **Different ratings** is the default view; choose **All diary entries**, **Matching ratings** or **Unable to compare**, and optionally filter by title. Use **Show more entries** to browse more than 100 results.

An unrated entry differs from a star rating; two unrated values match. Missing films, unreadable film identities or unreadable rating markers are marked **Unable to compare**, rather than counted as matches or differences. An unreadable diary row stays in the results and does not stop the rest of the scan. Its diary-page link remains available for manual inspection. Ratings may differ intentionally when opinions change. No ratings are edited.

Keep the tab open during the scan. **Stop** leaves the results labeled incomplete; **Restart comparison** starts over. **Compare again** loads fresh data. Comparison data is kept only in memory in this tab and is not saved in the search cache. Changes made on Letterboxd during the scan may require another comparison.

## Cache and controls

- **Stop** cancels loading. Partial results remain clearly labeled as incomplete; they are never saved as a complete collection. **Reload films** starts again from page one.
- **Refresh** fetches a fresh collection, including newly watched films. The search always covers the full collection, regardless of the current page's filters.
- **Clear cache** removes this member's saved collection from extension storage.
- Complete collections are cached locally for six hours. Expired entries are discarded when revisited. Up to five member collections are retained as new ones are saved.
- Search ratings reflect the last load; use **Refresh** to pick up changes. Older caches without ratings are automatically discarded so the next search reloads them.

## Privacy and permissions

Runs only on `https://letterboxd.com/`. The only API permission is `storage`, used to cache film titles, slugs, years, member Films ratings and update times on this device. No analytics, backend, API keys, remote scripts, passwords, or cookie-reading permission. Requests go directly to Letterboxd using the browser's current session. Diary entries and review text are not cached. Uninstalling the extension removes its cache.

This is an unofficial prototype. It reads Letterboxd's HTML, so site changes can require parser updates. It stops on errors, browser checks or rate limits rather than bypassing them. It does not reveal private or otherwise inaccessible content. It works on desktop Chrome, not inside Letterboxd's mobile app.

## Development and verification

No build step or package install. After editing, click the extension's reload button at `chrome://extensions`, then reload the Letterboxd tab.

Run logic and pagination tests with Node 20+:

```powershell
node --test tests/core.test.cjs
```

Start the local browser test server, then visit `http://127.0.0.1:8765/tests/browser.html` in Chrome:

```powershell
node tests/serve.cjs
```

Fixtures cover the legacy and newer poster metadata formats, diary rows, rating markers, empty collections, malformed pagination, and challenge pages. Browser tests also check loading multiple pages, searching, cache restoration, cache removal, diary comparison filters and stopping a comparison. These are representative fixtures, not a captured live-site snapshot.

Before calling a release verified, load it on live Letterboxd and check:

1. A profile and its Films page both show one search panel.
2. Search finds a film from page two or later, plus an unrated watched film.
3. Stop leaves a partial-results message; restarting reaches a complete collection.
4. Reloading the page uses the cache; Refresh picks up changes; Clear cache removes it.
5. A logged-out public profile works. Rate limits and browser checks display useful errors.
6. Searching from a filtered Films page still searches the entire collection.
7. Compare a diary rating with the member's current Films rating, including half stars, unrated entries and multiple watches of the same film. Check differences against the live entry and Films pages.
8. Stop a diary scan partway through, then restart it. Try all result filters and confirm no partial scan is labeled complete.
9. Confirm the average against the profile histogram's ten counts, including half stars. On a Films page, loading the average should request only the profile.

Live Letterboxd requests were unavailable in the build environment; live-site verification remains necessary.
