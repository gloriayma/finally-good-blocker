# Feature record

This is the living feature document for `finally-good-blocker`. A feature is not
complete until its user-visible behavior is added here. Entries describe what is
actually shipped; unbuilt ideas stay in the clearly marked future section.

## Shipped

### 2026-07-20 — Configurable blocked-site list

The settings page can add and remove whole-site rules. Pasted URLs are reduced to
their hostname, so paths, query strings, fragments, schemes, and ports do not
become part of the saved rule. The initial list is empty. The page contains only
its line drawing, the add-site form, and a compact editable table of blocked
sites. Each row shows the hostname and the rule's three numeric values; ordinary
saves happen silently. The add action is a small text control rather than
a filled button, and full-width separators provide the table's only persistent
horizontal rules. Hostnames are deliberately smaller, lighter, and normal-weight
relative to the section heading. Numeric values use spinner-free numeric text
fields centered within their table columns beneath the concise `hold`, `base`,
and `extra` labels. The add and remove actions have no underlines. The add-site
and blocked-sites headings share the same larger type treatment.

### 2026-07-20 — Exact-domain and subdomain matching

A saved hostname matches itself and true subdomains on every HTTP or HTTPS path.
For example, `reddit.com` matches `reddit.com` and `old.reddit.com`, but not
`notreddit.com`. When saved rules overlap, the longest and therefore most
specific hostname wins. The implementation is kept small and literal in
`shared/domain.js` and at its call sites.

### 2026-07-20 — Per-site three-parameter access scheme

Every site independently configures:

1. Seconds the unlock button must first be held.
2. Base seconds of access earned when that threshold is reached.
3. Additional access seconds earned for every additional hold second.

The defaults are 10 seconds of holding, 30 seconds of base access, and 5 seconds
of additional access for each extra second held.

### 2026-07-20 — Hold-to-unlock blocking page

Blocked top-level navigations are redirected to a deliberately bare extension
page containing only a centered hold button. Holding produces no visual feedback
at all: there is no illustration, progress fill, countdown, ready state, earned
access, or remaining-time display, and the `press and hold` label never changes.
The label uses normal rather than bold type. The only visible outcome is
navigation after a successful release beyond the threshold. Releasing early or
cancelling the hold earns nothing. Mouse, touch/pointer, Space, and Enter input
are supported.

### 2026-07-20 — Wall-clock access shared across tabs

An unlock window belongs to the matching site rule, not to one tab. Other blocked
tabs for that site open when the shared timer changes. Access continues to elapse
while tabs or Firefox are in the background.

### 2026-07-20 — Persistent per-visit site-time history

Every hostname ever added to the block list is also remembered in a separate
tracking list. Removing its blocking rule does not remove that hostname or its
Firefox host permission, so future visits continue to be recorded without
continuing to block the site.

A visit is time spent with a matching page as the active tab in Firefox's
focused window. It starts when that page becomes active and ends when the user
switches tabs, navigates away, closes the tab or window, or moves focus away
from Firefox. Returning to an already-open tracked tab starts a new visit.
Subdomains are attributed to the longest matching tracked hostname, using the
same exact-domain/subdomain rule as blocking. Time spent on the extension's
blocking page is not site time.

Completed visits are append-only local-storage records named `siteVisit:<id>`.
Each stores a version, stable visit ID, `firefox` source, `website` kind,
configured hostname, start and end timestamps, duration in milliseconds, and
the Firefox-session tab and window IDs. The in-progress visit is stored
separately and checkpointed every 30 seconds. On Firefox startup, an unfinished
visit is closed at its last checkpoint so time while Firefox was closed is not
counted; an abrupt shutdown can therefore undercount by up to roughly 30
seconds. No history-pruning policy or history interface exists yet.

Only configured hostnames and timing metadata are saved. Page paths, query
strings, titles, contents, clicks, and keystrokes are not stored or transmitted.
The extension requests `unlimitedStorage` because the requested history is not
automatically discarded, though storage can still fail if the device or Firefox
profile reaches a broader storage limit.

### 2026-07-20 — Active-site toolbar countdown

While the active tab is on a site with temporary access, the extension toolbar
badge counts down its remaining wall-clock time. The badge changes with the
active tab and disappears on unrelated or reblocked pages. Hovering the toolbar
button shows the matching hostname and a fully written remaining duration. A
Firefox alarm supplies each tick so the countdown survives Manifest V3
background-page suspension without adding a new permission.

### 2026-07-20 — Automatic re-blocking at expiry

Firefox schedules an alarm for the end of each access window. When it fires,
already-open tabs governed by the expired rule are returned to the blocking page.
New navigations are also blocked after expiry. Active alarms are restored after
Firefox restarts.

### 2026-07-20 — Per-site permission requests

The extension begins with no website access. Adding a site asks Firefox for
access to that hostname and its subdomains so top-level navigation can be
intercepted and active visits can be timed. Removing a blocking rule deliberately
retains the matching permission because tracking continues. Page contents are
never read or modified; configuration, timers, and visit records stay in local
extension storage.

### 2026-07-20 — Minimal `gloria.ma`-inspired presentation

The blocking and settings pages use the site's warm off-white ground, dark brown
system type, restrained text actions, narrow 700px measure, generous empty
space, and small line drawings. The extension icon and settings-page drawing now
depict the configured access function itself: a dominant zero-access plateau, a
large vertical jump for base access at the hold threshold, and a short rising
line for access earned through continued holding. No assets or page content are
copied from the site.

### 2026-07-20 — Dependency-free Firefox project

The extension is plain HTML, CSS, and JavaScript using Manifest V3. It includes a
Firefox add-on ID, an explicit declaration of no external data collection,
automated tests for matching and timing, a manifest/file check, and temporary
installation instructions.

## Future ideas — not built

### Piecewise access functions

Allow each site to use a fully piecewise hold-time → access-time function instead
of the current three-parameter line.

### Funny LaTeX-style function editor

Provide a playful mathematical expression editor for defining and displaying the
piecewise function. The exact syntax and error model still need design.

### Draw the function on a graph

Provide a graph drawer where the user can sketch the hold-time → access-time
curve directly, then inspect and edit the resulting function. How freehand input
becomes a stable monotone function still needs design.

### Unified Firefox and macOS activity history

When the native macOS blocker exists, a local Firefox native-messaging host can
copy browser visit records into the macOS app's activity database. Application
sessions would use the same conceptual fields but identify a bundle identifier
instead of a hostname. Delivery should be acknowledged and deduplicated by the
stable visit ID so browser or app restarts cannot create duplicate history. No
native host, cross-process synchronization, macOS activity database, or combined
history interface is implemented yet.
