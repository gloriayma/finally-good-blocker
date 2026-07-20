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
saves happen silently. The add action is a small underlined control rather than
a filled button, and full-width separators provide the table's only persistent
horizontal rules. Hostnames are deliberately smaller and lighter than the
section heading. Numeric values are centered, omit browser spinner arrows, and
sit beneath the concise `hold`, `base`, and `extra` column labels. The add-site
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
page containing only a line-drawn pause graphic and the hold button. The button
fills during the initial hold but its label stays `press and hold`: it never
shows a countdown, earned access, or remaining time. It unlocks only on release
after the threshold. Releasing early or cancelling the hold earns nothing.
The illustration and button are centered together. Mouse, touch/pointer, Space,
and Enter input are supported.

### 2026-07-20 — Wall-clock access shared across tabs

An unlock window belongs to the matching site rule, not to one tab. Other blocked
tabs for that site open when the shared timer changes. Access continues to elapse
while tabs or Firefox are in the background.

### 2026-07-20 — Automatic re-blocking at expiry

Firefox schedules an alarm for the end of each access window. When it fires,
already-open tabs governed by the expired rule are returned to the blocking page.
New navigations are also blocked after expiry. Active alarms are restored after
Firefox restarts.

### 2026-07-20 — Per-site permission requests

The extension begins with no website access. Adding a site asks Firefox for
access to that hostname and its subdomains so top-level navigation can be
intercepted. Removing a site removes the matching permission request when
possible. Page contents are never read or modified; all configuration and timer
state stays in local extension storage.

### 2026-07-20 — Minimal `gloria.ma`-inspired presentation

The blocking and settings pages use the site's warm off-white ground, dark brown
system type, restrained underlined actions, narrow 700px measure, generous empty
space, and small line drawings. No assets or page content are copied from the
site.

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
