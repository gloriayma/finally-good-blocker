# finally-good-blocker

A deliberately small Firefox extension with switchable blocklist and
whitelist-only modes. A disallowed site can be opened temporarily only by
holding a button long enough to earn access time.

It targets Firefox 142 and newer.

The settings and blocking pages automatically follow Firefox's light or dark
appearance.

## Interface

### Settings

![The minimal finally-good-blocker settings screen](docs/options-screen.svg)

### Blocking page

![The blocking page with only its centered hold button](docs/blocking-screen.svg)

The icon and settings-page line drawing depict the access function: no access
before the hold threshold, a jump to base access, then steadily increasing access
for additional hold time.

The default rule is:

- Hold for 10 seconds to earn 30 seconds of access.
- After the first 10 seconds, every additional second held earns 5 additional
  seconds of access.
- Access is wall-clock time, shared by every Firefox tab for that site.

Each blocklist site has its own editable copy of those three values. In allowlist
mode, every disallowed hostname uses the defaults without being saved.
While an unlocked site is active, the extension's toolbar badge counts down its
remaining access time; hover the icon for the full duration.

The settings-page `blocklist / allowlist` switch remembers an independent list
for each mode. An empty allowlist intentionally disallows the entire HTTP and
HTTPS web. Allowed hostnames include their real subdomains. Only top-level page
navigation is restricted, so an allowed page can still load its images, scripts,
APIs, and sign-in flows from other hosts.

## Local site-time history

The extension records time only while a currently disallowed site is open through
a live temporary-access window. Permanently allowed pages, ordinary unconfigured
pages in blocklist mode, and the extension's blocking screen are not timed. A
visit means the page is the active tab in the focused Firefox window. Switching
tabs, navigating away, closing the tab, or focusing another app ends that visit;
returning starts another one while access remains active.

Each completed visit is kept as its own `siteVisit:<id>` record in Firefox local
extension storage, containing the configured hostname, start and end times, and
duration. The current visit is checkpointed every 30 seconds. There is not yet a
history screen or automatic pruning.

## Install temporarily in Firefox

1. Open `about:debugging` in Firefox.
2. Choose **This Firefox**.
3. Choose **Load Temporary Add-on…**.
4. Select this project's `manifest.json`.
5. Click the extension's toolbar button to open its settings.

Temporary add-ons are removed when Firefox closes. Publishing or permanent
self-installation requires signing through Mozilla Add-ons.

## Domain matching and permissions

In blocklist mode, adding a domain asks Firefox for permission to access only
that hostname and its subdomains. Removing the rule also removes that permission.
For example, the requested WebExtension match pattern for `reddit.com` is:

```text
*://*.reddit.com/*
```

The matching rule used by the blocker itself is intentionally direct:

```js
currentHostname === savedHostname ||
  currentHostname.endsWith(`.${savedHostname}`)
```

The leading dot in the second comparison means `old.reddit.com` matches while
`notreddit.com` does not. All HTTP and HTTPS paths match. If rules overlap, the
longest (most specific) saved hostname wins.

Enabling allowlist mode asks once for access to all HTTP and HTTPS websites,
because the extension must see a destination before it can reject an unlisted
one. Disabling allowlist mode immediately gives up that all-sites permission and
returns to the remembered per-blocklist permissions. Firefox-internal pages and
other non-web schemes are outside the restriction.

The extension compares top-level navigation and active-tab URLs with locally
saved hostnames. It stores only configuration plus the hostname and timing of
temporary visits—not full URLs, titles, page contents, clicks, or keystrokes.
Nothing is transmitted outside Firefox on this device. Uninstalling the
extension removes its local storage.

## Development

There is no build step and there are no runtime dependencies.

```sh
npm test
npm run check
```

Create a distributable archive from the project directory with:

```sh
zip -r dist/finally-good-blocker-0.1.0.zip . \
  -x 'dist/*' -x '.git/*' -x '.DS_Store'
```

## Feature record

[`FEATURES.md`](FEATURES.md) is the living record of shipped behavior and future
ideas. Every future feature should receive an entry there as part of its change.
