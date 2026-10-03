# Code Review and Optimization Notes

Baseline: `dce58c7` on `main`. Scope: PDF/audio selection, history synchronization,
list rendering and background task state. This is a targeted review, not a full
security audit or a live website download test.

## Implemented in This Pass

| Finding | Change | Regression coverage |
| --- | --- | --- |
| Explicit empty candidate arrays were treated as unrestricted batches. | Preserve the distinction between an omitted selection and `[]`; show an empty-selection message in the audio popup. | Selector and background message tests. |
| PDF task selection ignored the popup sort before applying the limit. | Share selection/date/sort rules; pass PDF sort to the background. | Fixed queue order and limit tests. |
| Audio entries without upload times disappeared even with no date filter. | Accept unknown dates without bounds; exclude them when a date bound is active. | Date boundary and audio batch tests. |
| Audio re-queried the active tab for every task. | Retain the tab selected at batch startup; keep single-download behavior unchanged. | Simulated active-tab switch during a two-item batch. |
| Remote `null`/blank download counts became zero; missing workflow flags became "not submitted". | Preserve local counts unless a valid nonnegative value is supplied; distinguish unknown workflow state from explicit `submitted: false`. | Null, blank, invalid, zero and workflow-state cases. |
| History requests lacked a deadline and discarded HTTP error details. | Sign and send the same body; apply a 15-second request/body deadline; report endpoint, kind, HTTP status and bounded JSON error details. Redact credentials and reject redirects. | Independent HMAC verification, HTTP/JSON/network errors and stalled headers/body tests. |
| List attributes and logs interpolated unescaped external text. | Escape filenames, row metadata and log messages before HTML interpolation. | Quote, ampersand and markup escaping tests. |

History errors and incomplete responses still leave existing lists and trusted
history unchanged. The temporary localhost endpoint, credentials configuration,
download success rules and duplicate-history behavior were not changed.

## Remaining Priorities

### P1: Serialize List Mutations

`src/background/main.js` imports, status updates, reconciliation and history sync
all perform read-modify-write operations. `src/popup/popup.js` also writes imported
and cleared lists directly. Concurrent operations can overwrite newer data.
This is a code-level risk, not a confirmed explanation of earlier screenshots.

Next step: move mutations behind one background-owned interface, serialize them
per list and add tests that interleave import, completion, clear and sync.
Locking only imports would not solve cross-writer races.

### P1: Persist Audio Batch State and Isolate Cancellation

`startBatchAudioDownload` uses an in-memory loop and delays, unlike the persisted
PDF task queue. Worker interruption can lose progress. Stop/restart also shares
global flags with an already-running task; an old completion can affect a new
batch. Some asynchronous message entry points lack a catch/finally cleanup.

Next step: use persisted task IDs and queue state, reject stale completions, and
test worker restart, stop during a click, immediate restart and disconnected tabs.
This requires a focused queue change rather than extending request timeouts.

### P2: Reduce Popup Work and Import Lookup Cost

Every storage change currently rebuilds both lists and logs and rebinds all row
handlers. Import helpers repeatedly search the existing list for every new item.

Next step: filter storage notifications by key, coalesce renders, update only the
affected view, delegate row events, and index imports by stable file ID with the
existing name fallback. Benchmark against large lists before changing rendering.

## Verification and Release Checks

Run `node --test test/*.test.mjs` and `git diff --check`.

Automated tests use mocked Chrome APIs and request responses; they do not certify
the site's current DOM, actual file completion or local server health. After
reloading the extension and the site, manually check PDF sorting, an audio batch
while switching tabs, and history synchronization. A real HTTP 500 still requires
server-side investigation; improved diagnostics do not repair that server error.
