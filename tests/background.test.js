const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function loadBackground({ settings, accessUntilBySiteId = {}, now = 1_000_000, tabs = [] }) {
  const storage = { settings, accessUntilBySiteId };
  const listeners = {};
  const alarmCreations = [];
  const alarmClears = [];
  const tabUpdates = [];
  const badgeTexts = [];
  const badgeBackgrounds = [];
  const actionTitles = [];

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
      onUpdated: { addListener(listener) { listeners.tabUpdated = listener; } },
      async update(tabId, change) {
        tabUpdates.push({ tabId, change });
        return { id: tabId, ...change };
      },
    },
    windows: {
      onFocusChanged: { addListener(listener) { listeners.windowFocused = listener; } },
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
    updateBadge() {
      return vm.runInContext("updateActiveTabBadge()", context);
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
