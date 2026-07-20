const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function loadBackground({
  settings,
  accessUntilBySiteId = {},
  trackedSites,
  activeTrackedVisit,
  now = 1_000_000,
  tabs = [],
  focusedWindow,
}) {
  const storage = { settings, accessUntilBySiteId, trackedSites, activeTrackedVisit };
  const listeners = {};
  const alarmCreations = [];
  const alarmClears = [];
  const tabUpdates = [];
  const badgeTexts = [];
  const badgeBackgrounds = [];
  const actionTitles = [];
  let currentFocusedWindow = focusedWindow || {
    id: 1,
    focused: true,
    tabs,
  };

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  const browser = {
    action: {
      async setBadgeText(details) { badgeTexts.push(details); },
      async setBadgeBackgroundColor(details) { badgeBackgrounds.push(details); },
      async setTitle(details) { actionTitles.push(details); },
      onClicked: { addListener(listener) { listeners.action = listener; } },
    },
    alarms: {
      create(name, details) { alarmCreations.push({ name, details }); },
      async clear(name) {
        alarmClears.push(name);
        return true;
      },
      onAlarm: { addListener(listener) { listeners.alarm = listener; } },
    },
    runtime: {
      getURL(relativePath) { return `moz-extension://test/${relativePath}`; },
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onMessage: { addListener(listener) { listeners.message = listener; } },
      onStartup: { addListener(listener) { listeners.startup = listener; } },
      openOptionsPage() {},
    },
    storage: {
      onChanged: { addListener(listener) { listeners.storageChanged = listener; } },
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return { [keys]: storage[keys] };
          }
          return Object.fromEntries(keys.map((key) => [key, storage[key]]));
        },
        async set(values) { Object.assign(storage, values); },
      },
    },
    tabs: {
      async query(queryInfo) {
        if (queryInfo.active) {
          return tabs.filter((tab) => tab.active);
        }
        return tabs;
      },
      onActivated: { addListener(listener) { listeners.tabActivated = listener; } },
      onRemoved: { addListener(listener) { listeners.tabRemoved = listener; } },
      onUpdated: { addListener(listener) { listeners.tabUpdated = listener; } },
      async update(tabId, change) {
        tabUpdates.push({ tabId, change });
        return { id: tabId, ...change };
      },
    },
    windows: {
      async getLastFocused() { return currentFocusedWindow; },
      onFocusChanged: { addListener(listener) { listeners.windowFocused = listener; } },
      onRemoved: { addListener(listener) { listeners.windowRemoved = listener; } },
    },
    webRequest: {
      onBeforeRequest: {
        addListener(listener) { listeners.beforeRequest = listener; },
      },
    },
  };

  const context = vm.createContext({
    browser,
    console,
    Date: FakeDate,
    URL,
    globalThis: null,
    module: undefined,
  });
  context.globalThis = context;

  for (const relativePath of ["shared/domain.js", "shared/scheme.js", "background.js"]) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }

  return {
    storage,
    listeners,
    alarmCreations,
    alarmClears,
    tabUpdates,
    badgeTexts,
    badgeBackgrounds,
    actionTitles,
    setNow(value) { now = value; },
    setFocusedWindow(value) { currentFocusedWindow = value; },
    updateBadge() {
      return vm.runInContext("updateActiveTabBadge()", context);
    },
    reconcileTracking(options = {}) {
      context.__trackingOptions = options;
      return vm.runInContext("reconcileTrackedVisit(__trackingOptions)", context);
    },
    redirectExpired(siteId) {
      return vm.runInContext(`redirectTabsWhenAccessExpires(${JSON.stringify(siteId)})`, context);
    },
  };
}

const redditSite = {
  id: "reddit",
  hostname: "reddit.com",
  scheme: {
    holdThresholdSeconds: 10,
    baseAccessSeconds: 30,
    accessSecondsPerExtraHoldSecond: 5,
  },
};

test("redirects exact domains and subdomains, but not suffix lookalikes", async () => {
  const app = loadBackground({ settings: { version: 1, sites: [redditSite] } });

  const exact = await app.listeners.beforeRequest({ url: "https://reddit.com/r/firefox" });
  const subdomain = await app.listeners.beforeRequest({ url: "https://old.reddit.com/" });
  const lookalike = await app.listeners.beforeRequest({ url: "https://notreddit.com/" });

  assert.match(exact.redirectUrl, /^moz-extension:\/\/test\/blocked\/blocked\.html\?/);
  assert.match(subdomain.redirectUrl, /^moz-extension:\/\/test\/blocked\/blocked\.html\?/);
  assert.equal(Object.keys(lookalike).length, 0);
});

test("uses the most-specific rule when rules overlap", async () => {
  const oldRedditSite = { ...redditSite, id: "old-reddit", hostname: "old.reddit.com" };
  const app = loadBackground({
    settings: { version: 1, sites: [redditSite, oldRedditSite] },
  });

  const response = await app.listeners.beforeRequest({ url: "https://old.reddit.com/" });
  const redirected = new URL(response.redirectUrl);
  assert.equal(redirected.searchParams.get("site"), "old-reddit");
});

test("a valid hold creates shared access and lets navigation through", async () => {
  const app = loadBackground({ settings: { version: 1, sites: [redditSite] } });

  const unlock = await app.listeners.message({
    type: "unlock-site",
    siteId: "reddit",
    targetUrl: "https://reddit.com/",
    heldMilliseconds: 10_000,
  });

  assert.equal(unlock.ok, true);
  assert.equal(unlock.earnedSeconds, 30);
  assert.equal(app.storage.accessUntilBySiteId.reddit, 1_030_000);
  assert.equal(app.alarmCreations.at(-1).name, "access-expired:reddit");
  assert.equal(app.alarmCreations.at(-1).details.when, 1_030_000);

  const allowed = await app.listeners.beforeRequest({ url: "https://reddit.com/" });
  assert.equal(Object.keys(allowed).length, 0);
});

test("the active unlocked site gets a toolbar countdown", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [redditSite] },
    accessUntilBySiteId: { reddit: 1_030_000 },
    tabs: [{ id: 7, active: true, url: "https://old.reddit.com/r/firefox" }],
  });

  await app.updateBadge();

  assert.equal(app.badgeTexts.at(-1).text, "30s");
  assert.equal(app.badgeTexts.at(-1).tabId, 7);
  assert.equal(app.badgeBackgrounds.at(-1).color, "#2d2926");
  assert.equal(app.badgeBackgrounds.at(-1).tabId, 7);
  assert.equal(app.actionTitles.at(-1).title, "reddit.com reblocks in 30 seconds");
  assert.equal(app.actionTitles.at(-1).tabId, 7);
  assert.equal(app.alarmCreations.at(-1).name, "active-tab-badge-tick");
  assert.equal(app.alarmCreations.at(-1).details.when, 1_001_000);

  app.setNow(1_001_001);
  await app.updateBadge();
  assert.equal(app.badgeTexts.at(-1).text, "29s");
  assert.equal(app.badgeTexts.at(-1).tabId, 7);
});

test("the toolbar countdown clears when access expires", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [redditSite] },
    accessUntilBySiteId: { reddit: 1_030_000 },
    now: 1_030_001,
    tabs: [{ id: 7, active: true, url: "https://reddit.com/" }],
  });

  await app.updateBadge();

  assert.equal(app.badgeTexts.at(-1).text, "");
  assert.equal(app.badgeTexts.at(-1).tabId, 7);
  assert.equal(app.actionTitles.at(-1).title, null);
  assert.equal(app.actionTitles.at(-1).tabId, 7);
  assert.equal(app.alarmClears.at(-1), "active-tab-badge-tick");
});

test("expiry re-blocks matching open tabs and leaves lookalikes alone", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [redditSite] },
    accessUntilBySiteId: { reddit: 1_030_000 },
    now: 1_030_001,
    tabs: [
      { id: 1, url: "https://old.reddit.com/r/firefox" },
      { id: 2, url: "https://notreddit.com/" },
    ],
  });

  await app.redirectExpired("reddit");

  assert.equal(app.storage.accessUntilBySiteId.reddit, undefined);
  assert.equal(app.tabUpdates.length, 1);
  assert.equal(app.tabUpdates[0].tabId, 1);
  assert.match(app.tabUpdates[0].change.url, /blocked\/blocked\.html/);
});

test("starts a durable visit for the focused tracked site", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [redditSite] },
    tabs: [{ id: 7, active: true, url: "https://old.reddit.com/r/firefox" }],
  });

  await app.reconcileTracking();

  assert.deepEqual(JSON.parse(JSON.stringify(app.storage.trackedSites)), {
    version: 1,
    hostnames: ["reddit.com"],
  });
  assert.equal(app.storage.activeTrackedVisit.source, "firefox");
  assert.equal(app.storage.activeTrackedVisit.kind, "website");
  assert.equal(app.storage.activeTrackedVisit.hostname, "reddit.com");
  assert.equal(app.storage.activeTrackedVisit.startedAt, 1_000_000);
  assert.equal(app.storage.activeTrackedVisit.lastSeenAt, 1_000_000);
  assert.equal(app.storage.activeTrackedVisit.tabId, 7);
  assert.equal(app.storage.activeTrackedVisit.windowId, 1);
});

test("finishes a visit when the user leaves the tracked site", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [] },
    trackedSites: { version: 1, hostnames: ["reddit.com"] },
    tabs: [{ id: 7, active: true, url: "https://reddit.com/" }],
  });

  await app.reconcileTracking();
  const visitId = app.storage.activeTrackedVisit.id;

  app.setNow(1_012_345);
  app.setFocusedWindow({
    id: 1,
    focused: true,
    tabs: [{ id: 8, active: true, url: "https://example.com/" }],
  });
  await app.reconcileTracking();

  assert.equal(app.storage.activeTrackedVisit, null);
  assert.deepEqual(JSON.parse(JSON.stringify(app.storage[`siteVisit:${visitId}`])), {
    version: 1,
    id: visitId,
    source: "firefox",
    kind: "website",
    hostname: "reddit.com",
    startedAt: 1_000_000,
    endedAt: 1_012_345,
    durationMilliseconds: 12_345,
    tabId: 7,
    windowId: 1,
  });
});

test("keeps tracking after the site has been removed from blocking", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [] },
    trackedSites: { version: 1, hostnames: ["reddit.com"] },
    tabs: [{ id: 4, active: true, url: "https://reddit.com/" }],
  });

  await app.reconcileTracking();

  assert.equal(app.storage.activeTrackedVisit.hostname, "reddit.com");
  assert.equal(app.storage.activeTrackedVisit.tabId, 4);
});

test("switching between two tabs on one site creates two visits", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [] },
    trackedSites: { version: 1, hostnames: ["reddit.com"] },
    tabs: [{ id: 1, active: true, url: "https://reddit.com/" }],
  });

  await app.reconcileTracking();
  const firstVisitId = app.storage.activeTrackedVisit.id;

  app.setNow(1_005_000);
  app.setFocusedWindow({
    id: 1,
    focused: true,
    tabs: [{ id: 2, active: true, url: "https://old.reddit.com/" }],
  });
  await app.reconcileTracking();

  assert.equal(app.storage[`siteVisit:${firstVisitId}`].durationMilliseconds, 5_000);
  assert.equal(app.storage.activeTrackedVisit.hostname, "reddit.com");
  assert.equal(app.storage.activeTrackedVisit.tabId, 2);
  assert.notEqual(app.storage.activeTrackedVisit.id, firstVisitId);
});

test("moving focus away from Firefox ends the visit", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [] },
    trackedSites: { version: 1, hostnames: ["reddit.com"] },
    tabs: [{ id: 3, active: true, url: "https://reddit.com/" }],
  });

  await app.reconcileTracking();
  const visitId = app.storage.activeTrackedVisit.id;

  app.setNow(1_003_000);
  app.setFocusedWindow({
    id: 1,
    focused: false,
    tabs: [{ id: 3, active: true, url: "https://reddit.com/" }],
  });
  await app.reconcileTracking();

  assert.equal(app.storage.activeTrackedVisit, null);
  assert.equal(app.storage[`siteVisit:${visitId}`].durationMilliseconds, 3_000);
});

test("browser startup does not count time Firefox was closed", async () => {
  const app = loadBackground({
    settings: { version: 1, sites: [] },
    trackedSites: { version: 1, hostnames: ["reddit.com"] },
    activeTrackedVisit: {
      version: 1,
      id: "old-browser-session",
      source: "firefox",
      kind: "website",
      hostname: "reddit.com",
      startedAt: 900_000,
      lastSeenAt: 950_000,
      tabId: 7,
      windowId: 1,
    },
    now: 1_000_000,
    tabs: [{ id: 7, active: true, url: "https://reddit.com/" }],
  });

  await app.reconcileTracking({ startNewBrowserSession: true });

  assert.equal(app.storage["siteVisit:old-browser-session"].endedAt, 950_000);
  assert.equal(
    app.storage["siteVisit:old-browser-session"].durationMilliseconds,
    50_000,
  );
  assert.equal(app.storage.activeTrackedVisit.startedAt, 1_000_000);
  assert.notEqual(app.storage.activeTrackedVisit.id, "old-browser-session");
});
