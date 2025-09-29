# PWA Cache Refresh Improvements

## Overview
The CalorieCam PWA currently serves stale UI after source changes because the service worker responds with cached assets before fetching updates. Developers using Live Server (and end users receiving new deployments) have to clear storage or unregister the service worker to see the latest interface.

## Goals
- Ensure that reloading the application fetches the newest HTML and JavaScript when online.
- Preserve offline functionality by falling back to cached content when the network is unavailable.
- Reduce stale cache issues without requiring manual cache/version bumps during normal development or deployment.

## Non-Goals
- Full offline-first behavior for every asset (a short online window is acceptable during navigation refresh).
- Introducing build steps or bundlers; the project should remain no-build.

## Current Behavior Summary
- `sw.js` uses a single cache (`caloriecam-shell-v2`) that is pre-populated during the `install` phase using `cache.addAll`.
- The `fetch` handler short-circuits when a cached response exists, returning it immediately while revalidating in the background.
- Because the cached response is returned synchronously, navigations and module requests serve the old UI during the first reload after code changes. Developers often assume the update failed and resort to clearing caches.

## Proposed Changes
1. **Network-first strategy for navigations and same-origin shell modules**
   - Attempt a network fetch first and update the cache on success.
   - Fallback to the cached response (or `/index.html` for navigations) when offline.
2. **Maintain cache population for offline usage**
   - Keep the existing `SHELL_FILES` list, but allow runtime fetches to refresh cached entries.
3. **Explicit cache version bump**
   - Increase `CACHE_NAME` to `caloriecam-shell-v3` to ensure the new strategy takes effect immediately and to clear stale entries left by the previous version.

## Edge Cases & Error Handling
- **Offline navigation**: Serve cached `/index.html` for navigational requests when the network fetch fails.
- **External CDN failure**: Continue using cached Pico CSS when unpkg is unreachable.
- **Development host variations**: Match navigations based on `request.mode === 'navigate'` to handle arbitrary local server ports.

## Testing Strategy
- Manual verification in a Live Server session:
  1. Start the app, ensure service worker registers.
  2. Modify `src/ui/app.js`, reload, confirm the updated UI appears immediately.
  3. Disconnect network (or simulate offline), reload, confirm cached UI still loads.
- Automated tests are not available for service worker logic; document the manual QA steps above.

## Integration Notes
- Changes are isolated to `sw.js`.
- No dependency updates or other build configuration changes are required.
