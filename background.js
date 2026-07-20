const { hostnameMatchesSite } = FinallyGoodBlockerDomain;
const { cleanScheme, calculateEarnedSeconds } = FinallyGoodBlockerScheme;

const SETTINGS_KEY = "settings";
const ACCESS_KEY = "accessUntilBySiteId";
const ALARM_PREFIX = "access-expired:";
const BADGE_ALARM = "active-tab-badge-tick";
const TRACKED_SITES_KEY = "trackedSites";
const ACTIVE_VISIT_KEY = "activeTrackedVisit";
const VISIT_KEY_PREFIX = "siteVisit:";
const TRACKING_HEARTBEAT_ALARM = "tracking-heartbeat";
const TRACKING_HEARTBEAT_MINUTES = 0.5;

async function readState() {
  const stored = await browser.storage.local.get([SETTINGS_KEY, ACCESS_KEY]);
  const settings = stored[SETTINGS_KEY] || { version: 1, sites: [] };

  if (!Array.isArray(settings.sites)) {
    settings.sites = [];
  }

  return {
    settings,
    accessUntilBySiteId: stored[ACCESS_KEY] || {},
  };
}

function makeVisitId(now, tabId) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${now}-${tabId}-${Math.random().toString(16).slice(2)}`;
}

async function readTrackingState() {
  const stored = await browser.storage.local.get([
    SETTINGS_KEY,
    TRACKED_SITES_KEY,
    ACTIVE_VISIT_KEY,
  ]);

  const savedHostnames = Array.isArray(stored[TRACKED_SITES_KEY]?.hostnames)
    ? stored[TRACKED_SITES_KEY].hostnames
    : [];
  const configuredSites = Array.isArray(stored[SETTINGS_KEY]?.sites)
    ? stored[SETTINGS_KEY].sites
    : [];

  // The tracking list is intentionally separate from the current block list.
  // Current rules are copied into it, but deleting a rule never removes its
  // hostname. That site therefore keeps accumulating visits after unblocking.
  const trackedHostnames = [...new Set([
    ...savedHostnames.filter((hostname) => typeof hostname === "string"),
    ...configuredSites
      .map((site) => site.hostname)
      .filter((hostname) => typeof hostname === "string"),
  ])];

  if (
    trackedHostnames.length !== savedHostnames.length ||
    trackedHostnames.some((hostname, index) => hostname !== savedHostnames[index])
  ) {
    await browser.storage.local.set({
      [TRACKED_SITES_KEY]: { version: 1, hostnames: trackedHostnames },
    });
  }

  const activeVisit = stored[ACTIVE_VISIT_KEY];
  const hasValidActiveVisit =
    activeVisit &&
    activeVisit.version === 1 &&
    typeof activeVisit.id === "string" &&
    typeof activeVisit.hostname === "string" &&
    Number.isFinite(activeVisit.startedAt) &&
    Number.isFinite(activeVisit.lastSeenAt) &&
    Number.isInteger(activeVisit.tabId) &&
    Number.isInteger(activeVisit.windowId);

  return {
    trackedHostnames,
    activeVisit: hasValidActiveVisit ? activeVisit : null,
  };
}

async function getFocusedTrackedPage(trackedHostnames) {
  let focusedWindow;
  try {
    focusedWindow = await browser.windows.getLastFocused({ populate: true });
  } catch {
    return null;
  }

  if (!focusedWindow?.focused || !Array.isArray(focusedWindow.tabs)) {
    return null;
  }

  const activeTab = focusedWindow.tabs.find((tab) => tab.active);
  if (!activeTab || activeTab.id == null || !activeTab.url) {
    return null;
  }

  let page;
  try {
    page = new URL(activeTab.url);
  } catch {
    return null;
  }

  if (page.protocol !== "http:" && page.protocol !== "https:") {
    return null;
  }

  const hostname = page.hostname.toLowerCase().replace(/\.$/, "");

  // Use the same literal matching rule as blocking. The longest saved hostname
  // wins when both a parent domain and a subdomain have ever been configured.
  const matchingHostnames = trackedHostnames.filter((trackedHostname) =>
    hostnameMatchesSite(hostname, trackedHostname),
  );
  matchingHostnames.sort((a, b) => b.length - a.length);

  if (!matchingHostnames[0]) {
    return null;
  }

  return {
    hostname: matchingHostnames[0],
    tabId: activeTab.id,
    windowId: focusedWindow.id,
  };
}

async function reconcileTrackedVisit({ startNewBrowserSession = false } = {}) {
  const now = Date.now();
  const { trackedHostnames, activeVisit } = await readTrackingState();
  const currentPage = await getFocusedTrackedPage(trackedHostnames);

  const continuingSameVisit =
    !startNewBrowserSession &&
    activeVisit &&
    currentPage &&
    activeVisit.hostname === currentPage.hostname &&
    activeVisit.tabId === currentPage.tabId &&
    activeVisit.windowId === currentPage.windowId;

  if (continuingSameVisit) {
    await browser.storage.local.set({
      [ACTIVE_VISIT_KEY]: { ...activeVisit, lastSeenAt: now },
    });
    return;
  }

  if (!activeVisit && !currentPage) {
    return;
  }

  const updates = {};

  if (activeVisit) {
    // runtime.onStartup marks a new Firefox session. In that case tab IDs may
    // have been reused, so close the prior visit at its last heartbeat instead
    // of counting time while Firefox was closed.
    const requestedEnd = startNewBrowserSession ? activeVisit.lastSeenAt : now;
    const endedAt = Math.max(activeVisit.startedAt, Math.min(now, requestedEnd));
    updates[`${VISIT_KEY_PREFIX}${activeVisit.id}`] = {
      version: 1,
      id: activeVisit.id,
      source: "firefox",
      kind: "website",
      hostname: activeVisit.hostname,
      startedAt: activeVisit.startedAt,
      endedAt,
      durationMilliseconds: endedAt - activeVisit.startedAt,
      tabId: activeVisit.tabId,
      windowId: activeVisit.windowId,
    };
  }

  updates[ACTIVE_VISIT_KEY] = currentPage
    ? {
        version: 1,
        id: makeVisitId(now, currentPage.tabId),
        source: "firefox",
        kind: "website",
        hostname: currentPage.hostname,
        startedAt: now,
        lastSeenAt: now,
        tabId: currentPage.tabId,
        windowId: currentPage.windowId,
      }
    : null;

  await browser.storage.local.set(updates);
}

let trackingQueue = Promise.resolve();

function scheduleTrackingReconcile(options) {
  trackingQueue = trackingQueue
    .then(() => reconcileTrackedVisit(options))
    .catch((error) => console.error(error));
  return trackingQueue;
}

function ensureTrackingHeartbeat() {
  browser.alarms.create(TRACKING_HEARTBEAT_ALARM, {
    periodInMinutes: TRACKING_HEARTBEAT_MINUTES,
  });
}

function makeBlockedPageUrl(siteId, targetUrl) {
  const blockedPage = new URL(browser.runtime.getURL("blocked/blocked.html"));
  blockedPage.searchParams.set("site", siteId);
  blockedPage.searchParams.set("target", targetUrl);
  return blockedPage.href;
}

function makeBadgeText(remainingSeconds) {
  if (remainingSeconds <= 99) {
    return `${remainingSeconds}s`;
  }

  if (remainingSeconds <= 999) {
    return String(remainingSeconds);
  }

  if (remainingSeconds < 60 * 60) {
    return `${Math.ceil(remainingSeconds / 60)}m`;
  }

  if (remainingSeconds < 100 * 60 * 60) {
    return `${Math.ceil(remainingSeconds / 60 / 60)}h`;
  }

  return "99h+";
}

function makeBadgeTitle(hostname, remainingSeconds) {
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }

  return `${hostname} reblocks in ${parts.join(" ")}`;
}

async function updateActiveTabBadge() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!activeTab || activeTab.id == null) {
    await browser.alarms.clear(BADGE_ALARM);
    return;
  }

  let target;
  try {
    target = new URL(activeTab.url);
  } catch {
    target = null;
  }

  let site;
  let accessUntil = 0;

  if (target && (target.protocol === "http:" || target.protocol === "https:")) {
    const { settings, accessUntilBySiteId } = await readState();
    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");

    // Use the same visible matching flow as navigation blocking: exact domain
    // or real subdomain, with the longest saved hostname winning.
    const matchingSites = settings.sites.filter((candidate) =>
      hostnameMatchesSite(hostname, candidate.hostname),
    );
    matchingSites.sort((a, b) => b.hostname.length - a.hostname.length);
    site = matchingSites[0];

    if (site) {
      accessUntil = Number(accessUntilBySiteId[site.id]) || 0;
    }
  }

  const remainingMilliseconds = accessUntil - Date.now();
  if (!site || remainingMilliseconds <= 0) {
    await Promise.all([
      browser.action.setBadgeText({ text: "", tabId: activeTab.id }),
      browser.action.setTitle({ title: null, tabId: activeTab.id }),
      browser.alarms.clear(BADGE_ALARM),
    ]);
    return;
  }

  const remainingSeconds = Math.ceil(remainingMilliseconds / 1000);
  await Promise.all([
    browser.action.setBadgeText({
      text: makeBadgeText(remainingSeconds),
      tabId: activeTab.id,
    }),
    browser.action.setBadgeBackgroundColor({
      color: "#2d2926",
      tabId: activeTab.id,
    }),
    browser.action.setTitle({
      title: makeBadgeTitle(site.hostname, remainingSeconds),
      tabId: activeTab.id,
    }),
  ]);

  // Firefox Manifest V3 background pages may unload while idle, so an alarm
  // provides the next tick instead of relying on setTimeout or setInterval.
  browser.alarms.create(BADGE_ALARM, {
    when: Math.min(accessUntil, Date.now() + 1000),
  });
}

browser.webRequest.onBeforeRequest.addListener(
  async (details) => {
    // Only normal web pages are in this listener's URL filter, but the explicit
    // check keeps the accepted schemes obvious and protects future changes.
    const target = new URL(details.url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return {};
    }

    const { settings, accessUntilBySiteId } = await readState();
    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");

    // A rule matches the exact hostname or a real subdomain. If overlapping
    // rules exist, the longest hostname is the most specific and wins.
    const matchingSites = settings.sites.filter((site) =>
      hostnameMatchesSite(hostname, site.hostname),
    );
    matchingSites.sort((a, b) => b.hostname.length - a.hostname.length);
    const site = matchingSites[0];

    if (!site) {
      return {};
    }

    const accessUntil = Number(accessUntilBySiteId[site.id]) || 0;
    if (Date.now() < accessUntil) {
      return {};
    }

    return { redirectUrl: makeBlockedPageUrl(site.id, details.url) };
  },
  { urls: ["*://*/*"], types: ["main_frame"] },
  ["blocking"],
);

browser.runtime.onMessage.addListener(async (message) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "get-blocked-page-state") {
    const { settings, accessUntilBySiteId } = await readState();
    const site = settings.sites.find((candidate) => candidate.id === message.siteId);

    let target;
    try {
      target = new URL(message.targetUrl);
    } catch {
      return { ok: false, error: "The original page URL is invalid." };
    }

    const isNormalWebPage = target.protocol === "http:" || target.protocol === "https:";
    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
    if (!site || !isNormalWebPage || !hostnameMatchesSite(hostname, site.hostname)) {
      return { ok: false, error: "This blocking page no longer matches a saved site." };
    }

    return {
      ok: true,
      site: {
        id: site.id,
        hostname: site.hostname,
        scheme: cleanScheme(site.scheme),
      },
      targetUrl: target.href,
      accessUntil: Number(accessUntilBySiteId[site.id]) || 0,
    };
  }

  if (message.type === "unlock-site") {
    const { settings, accessUntilBySiteId } = await readState();
    const site = settings.sites.find((candidate) => candidate.id === message.siteId);

    let target;
    try {
      target = new URL(message.targetUrl);
    } catch {
      return { ok: false, error: "The original page URL is invalid." };
    }

    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !site ||
      (target.protocol !== "http:" && target.protocol !== "https:") ||
      !hostnameMatchesSite(hostname, site.hostname)
    ) {
      return { ok: false, error: "The requested site does not match this rule." };
    }

    // The background page calculates the earned time from the saved scheme. The
    // blocked page reports only how long the button was held.
    const earnedSeconds = calculateEarnedSeconds(message.heldMilliseconds, site.scheme);
    if (earnedSeconds <= 0) {
      return { ok: false, error: "The button was not held long enough." };
    }

    const accessUntil = Date.now() + earnedSeconds * 1000;
    accessUntilBySiteId[site.id] = accessUntil;
    await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
    browser.alarms.create(`${ALARM_PREFIX}${site.id}`, { when: accessUntil });

    return { ok: true, earnedSeconds, accessUntil, targetUrl: target.href };
  }

  return undefined;
});

async function redirectTabsWhenAccessExpires(siteId) {
  const { settings, accessUntilBySiteId } = await readState();
  const site = settings.sites.find((candidate) => candidate.id === siteId);

  const accessUntil = Number(accessUntilBySiteId[siteId]) || 0;
  if (Date.now() < accessUntil) {
    browser.alarms.create(`${ALARM_PREFIX}${siteId}`, { when: accessUntil });
    return;
  }

  delete accessUntilBySiteId[siteId];
  await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });

  if (!site) {
    return;
  }

  const openTabs = await browser.tabs.query({});
  const redirects = [];

  for (const tab of openTabs) {
    if (tab.id == null || !tab.url) {
      continue;
    }

    let target;
    try {
      target = new URL(tab.url);
    } catch {
      continue;
    }

    if (target.protocol !== "http:" && target.protocol !== "https:") {
      continue;
    }

    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
    const matchingSites = settings.sites.filter((candidate) =>
      hostnameMatchesSite(hostname, candidate.hostname),
    );
    matchingSites.sort((a, b) => b.hostname.length - a.hostname.length);

    // A more-specific rule may cover this tab, so only redirect when the rule
    // whose timer expired is the rule that currently wins.
    if (matchingSites[0]?.id === siteId) {
      redirects.push(
        browser.tabs.update(tab.id, {
          url: makeBlockedPageUrl(siteId, target.href),
        }),
      );
    }
  }

  await Promise.all(redirects);
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) {
    updateActiveTabBadge().catch(console.error);
    return;
  }

  if (alarm.name === TRACKING_HEARTBEAT_ALARM) {
    scheduleTrackingReconcile();
    return;
  }

  if (!alarm.name.startsWith(ALARM_PREFIX)) {
    return;
  }

  const siteId = alarm.name.slice(ALARM_PREFIX.length);
  redirectTabsWhenAccessExpires(siteId).catch(console.error);
});

browser.tabs.onActivated.addListener(() => {
  updateActiveTabBadge().catch(console.error);
  scheduleTrackingReconcile();
});

browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    updateActiveTabBadge().catch(console.error);
    scheduleTrackingReconcile();
  }
});

browser.tabs.onRemoved.addListener(() => {
  scheduleTrackingReconcile();
});

browser.windows.onFocusChanged.addListener(() => {
  updateActiveTabBadge().catch(console.error);
  scheduleTrackingReconcile();
});

browser.windows.onRemoved.addListener(() => {
  scheduleTrackingReconcile();
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes[SETTINGS_KEY] || changes[ACCESS_KEY])) {
    updateActiveTabBadge().catch(console.error);
  }

  if (areaName === "local" && changes[SETTINGS_KEY]) {
    scheduleTrackingReconcile();
  }
});

async function restoreAccessAlarms() {
  const { settings, accessUntilBySiteId } = await readState();
  const knownSiteIds = new Set(settings.sites.map((site) => site.id));

  for (const [siteId, accessUntilValue] of Object.entries(accessUntilBySiteId)) {
    const accessUntil = Number(accessUntilValue) || 0;
    if (knownSiteIds.has(siteId) && Date.now() < accessUntil) {
      browser.alarms.create(`${ALARM_PREFIX}${siteId}`, { when: accessUntil });
    } else {
      delete accessUntilBySiteId[siteId];
    }
  }

  await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
}

browser.runtime.onStartup.addListener(() => {
  restoreAccessAlarms().catch(console.error);
  updateActiveTabBadge().catch(console.error);
  ensureTrackingHeartbeat();
  scheduleTrackingReconcile({ startNewBrowserSession: true });
});

browser.runtime.onInstalled.addListener(() => {
  restoreAccessAlarms().catch(console.error);
  updateActiveTabBadge().catch(console.error);
  ensureTrackingHeartbeat();
  scheduleTrackingReconcile();
});

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});
