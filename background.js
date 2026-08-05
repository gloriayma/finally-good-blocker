const { findMostSpecificSite } = FinallyGoodBlockerDomain;
const { DEFAULT_SCHEME, cleanScheme, calculateEarnedSeconds } = FinallyGoodBlockerScheme;
const {
  BLOCKLIST_MODE,
  ALLOWLIST_MODE,
  normalizeSettings,
} = FinallyGoodBlockerSettings;

const SETTINGS_KEY = "settings";
const ACCESS_KEY = "accessUntilBySiteId";
const ALARM_PREFIX = "access-expired:";
const BADGE_ALARM = "active-tab-badge-tick";
const ACTIVE_VISIT_KEY = "activeTrackedVisit";
const VISIT_KEY_PREFIX = "siteVisit:";
const TRACKING_HEARTBEAT_ALARM = "tracking-heartbeat";
const TRACKING_HEARTBEAT_MINUTES = 0.5;
const ALLOWLIST_DEFAULT_ACCESS_PREFIX = "allowlist-default:";
const BACKGROUND_API_VERSION = 2;

async function readState() {
  const stored = await browser.storage.local.get([SETTINGS_KEY, ACCESS_KEY]);
  const settings = normalizeSettings(stored[SETTINGS_KEY]);

  if (stored[SETTINGS_KEY]?.version !== settings.version) {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  return {
    settings,
    accessUntilBySiteId:
      stored[ACCESS_KEY] && typeof stored[ACCESS_KEY] === "object"
        ? stored[ACCESS_KEY]
        : {},
  };
}

function makeAllowlistDefaultAccessKey(hostname) {
  return `${ALLOWLIST_DEFAULT_ACCESS_PREFIX}${hostname}`;
}

function resolveRestriction(hostname, settings, accessUntilBySiteId = {}) {
  if (settings.mode === BLOCKLIST_MODE) {
    const site = findMostSpecificSite(hostname, settings.blocklistSites);
    return site
      ? {
          kind: BLOCKLIST_MODE,
          accessKey: site.id,
          hostname: site.hostname,
          scheme: cleanScheme(site.scheme),
        }
      : null;
  }

  if (findMostSpecificSite(hostname, settings.allowlistSites)) {
    return null;
  }

  const temporaryDefaultSites = Object.keys(accessUntilBySiteId)
    .filter((accessKey) => accessKey.startsWith(ALLOWLIST_DEFAULT_ACCESS_PREFIX))
    .map((accessKey) => ({
      accessKey,
      hostname: accessKey.slice(ALLOWLIST_DEFAULT_ACCESS_PREFIX.length),
    }));
  const matchingTemporaryDefault = findMostSpecificSite(
    hostname,
    temporaryDefaultSites,
  );
  if (matchingTemporaryDefault) {
    return {
      kind: "allowlist-default",
      accessKey: matchingTemporaryDefault.accessKey,
      hostname: matchingTemporaryDefault.hostname,
      scheme: { ...DEFAULT_SCHEME },
    };
  }

  // An unseen hostname is deliberately not persisted. It uses the default
  // access curve and receives a temporary key scoped to that hostname tree.
  return {
    kind: "allowlist-default",
    accessKey: makeAllowlistDefaultAccessKey(hostname),
    hostname,
    scheme: { ...DEFAULT_SCHEME },
  };
}

function parseWebUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return parsed;
}

function restrictionForUrl(value, settings, accessUntilBySiteId = {}) {
  const parsed = parseWebUrl(value);
  if (!parsed) {
    return { parsed: null, restriction: null };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return {
    parsed,
    restriction: resolveRestriction(hostname, settings, accessUntilBySiteId),
  };
}

function hasTemporaryAccess(restriction, accessUntilBySiteId, now = Date.now()) {
  if (!restriction) {
    return false;
  }

  return now < (Number(accessUntilBySiteId[restriction.accessKey]) || 0);
}

function isKnownAccessKey(accessKey, settings) {
  if (settings.mode === BLOCKLIST_MODE) {
    return settings.blocklistSites.some((site) => site.id === accessKey);
  }

  if (!accessKey.startsWith(ALLOWLIST_DEFAULT_ACCESS_PREFIX)) {
    return false;
  }

  const hostname = accessKey.slice(ALLOWLIST_DEFAULT_ACCESS_PREFIX.length);
  return resolveRestriction(hostname, settings)?.accessKey === accessKey;
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
    ACCESS_KEY,
    ACTIVE_VISIT_KEY,
  ]);
  const settings = normalizeSettings(stored[SETTINGS_KEY]);
  const accessUntilBySiteId =
    stored[ACCESS_KEY] && typeof stored[ACCESS_KEY] === "object"
      ? stored[ACCESS_KEY]
      : {};
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
    settings,
    accessUntilBySiteId,
    activeVisit: hasValidActiveVisit ? activeVisit : null,
  };
}

async function getFocusedTrackedPage(settings, accessUntilBySiteId) {
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

  const { restriction } = restrictionForUrl(
    activeTab.url,
    settings,
    accessUntilBySiteId,
  );

  // Only time a page that is currently disallowed and was deliberately opened
  // through a live press-and-hold access window. Allowed pages and blocking
  // screens never become history records.
  if (!hasTemporaryAccess(restriction, accessUntilBySiteId)) {
    return null;
  }

  return {
    hostname: restriction.hostname,
    tabId: activeTab.id,
    windowId: focusedWindow.id,
  };
}

async function reconcileTrackedVisit({ startNewBrowserSession = false } = {}) {
  const now = Date.now();
  const { settings, accessUntilBySiteId, activeVisit } = await readTrackingState();
  const currentPage = await getFocusedTrackedPage(settings, accessUntilBySiteId);

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

function makeBlockedPageUrl(accessKey, targetUrl) {
  const blockedPage = new URL(browser.runtime.getURL("blocked/blocked.html"));
  blockedPage.searchParams.set("site", accessKey);
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

  const { settings, accessUntilBySiteId } = await readState();
  const { restriction } = restrictionForUrl(
    activeTab.url,
    settings,
    accessUntilBySiteId,
  );
  const accessUntil = restriction
    ? Number(accessUntilBySiteId[restriction.accessKey]) || 0
    : 0;
  const remainingMilliseconds = accessUntil - Date.now();

  if (!restriction || remainingMilliseconds <= 0) {
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
      title: makeBadgeTitle(restriction.hostname, remainingSeconds),
      tabId: activeTab.id,
    }),
  ]);

  browser.alarms.create(BADGE_ALARM, {
    when: Math.min(accessUntil, Date.now() + 1000),
  });
}

browser.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const { settings, accessUntilBySiteId } = await readState();
    const { restriction } = restrictionForUrl(
      details.url,
      settings,
      accessUntilBySiteId,
    );

    if (!restriction || hasTemporaryAccess(restriction, accessUntilBySiteId)) {
      return {};
    }

    return { redirectUrl: makeBlockedPageUrl(restriction.accessKey, details.url) };
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
    const { parsed: target, restriction } = restrictionForUrl(
      message.targetUrl,
      settings,
      accessUntilBySiteId,
    );

    if (!target) {
      return { ok: false, error: "The original page URL is invalid." };
    }

    if (!restriction) {
      return { ok: true, restricted: false, targetUrl: target.href };
    }

    return {
      ok: true,
      restricted: true,
      site: {
        id: restriction.accessKey,
        hostname: restriction.hostname,
        scheme: restriction.scheme,
      },
      targetUrl: target.href,
      accessUntil: Number(accessUntilBySiteId[restriction.accessKey]) || 0,
    };
  }

  if (message.type === "get-extension-status") {
    const { settings } = await readState();
    const hasAllSitesPermission = await browser.permissions.contains({
      origins: ["*://*/*"],
    });
    return {
      ok: true,
      apiVersion: BACKGROUND_API_VERSION,
      mode: settings.mode,
      hasAllSitesPermission,
    };
  }

  if (message.type === "unlock-site") {
    const { settings, accessUntilBySiteId } = await readState();
    const { parsed: target, restriction } = restrictionForUrl(
      message.targetUrl,
      settings,
      accessUntilBySiteId,
    );

    if (!target || !restriction || restriction.accessKey !== message.siteId) {
      return { ok: false, error: "The requested site does not match this rule." };
    }

    // The background page calculates the earned time from the current rule. The
    // blocking page reports only how long the button was held.
    const earnedSeconds = calculateEarnedSeconds(
      message.heldMilliseconds,
      restriction.scheme,
    );
    if (earnedSeconds <= 0) {
      return { ok: false, error: "The button was not held long enough." };
    }

    const accessUntil = Date.now() + earnedSeconds * 1000;
    accessUntilBySiteId[restriction.accessKey] = accessUntil;
    await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
    browser.alarms.create(`${ALARM_PREFIX}${restriction.accessKey}`, {
      when: accessUntil,
    });

    return { ok: true, earnedSeconds, accessUntil, targetUrl: target.href };
  }

  return undefined;
});

async function enforceTab(tab) {
  if (!tab || tab.id == null || !tab.url) {
    return;
  }

  const { settings, accessUntilBySiteId } = await readState();
  const { parsed: target, restriction } = restrictionForUrl(
    tab.url,
    settings,
    accessUntilBySiteId,
  );

  if (!target || !restriction || hasTemporaryAccess(restriction, accessUntilBySiteId)) {
    return;
  }

  await browser.tabs.update(tab.id, {
    url: makeBlockedPageUrl(restriction.accessKey, target.href),
  });
}

async function enforceFocusedTab() {
  let focusedWindow;
  try {
    focusedWindow = await browser.windows.getLastFocused({ populate: true });
  } catch {
    return;
  }

  if (!focusedWindow?.focused || !Array.isArray(focusedWindow.tabs)) {
    return;
  }

  await enforceTab(focusedWindow.tabs.find((tab) => tab.active));
}

async function redirectTabsWhenAccessExpires(accessKey) {
  const { settings, accessUntilBySiteId } = await readState();
  const accessUntil = Number(accessUntilBySiteId[accessKey]) || 0;
  if (Date.now() < accessUntil) {
    browser.alarms.create(`${ALARM_PREFIX}${accessKey}`, { when: accessUntil });
    return;
  }

  const openTabs = await browser.tabs.query({});
  const redirects = [];

  for (const tab of openTabs) {
    if (tab.id == null || !tab.url) {
      continue;
    }

    const { parsed: target, restriction } = restrictionForUrl(
      tab.url,
      settings,
      accessUntilBySiteId,
    );
    if (!target || restriction?.accessKey !== accessKey) {
      continue;
    }

    redirects.push(
      browser.tabs.update(tab.id, {
        url: makeBlockedPageUrl(accessKey, target.href),
      }),
    );
  }

  await Promise.all(redirects);
  delete accessUntilBySiteId[accessKey];
  await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
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

  const accessKey = alarm.name.slice(ALARM_PREFIX.length);
  redirectTabsWhenAccessExpires(accessKey).catch(console.error);
});

browser.tabs.onActivated.addListener(() => {
  enforceFocusedTab().catch(console.error);
  updateActiveTabBadge().catch(console.error);
  scheduleTrackingReconcile();
});

browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.status === "complete")) {
    updateActiveTabBadge().catch(console.error);
    scheduleTrackingReconcile();
  }

  // webRequest is the pre-navigation enforcement path. This tab-level check is
  // a defensive fallback for a newly granted optional host permission and also
  // covers navigation that completes while the tab is in the background.
  if (changeInfo.url || changeInfo.status === "complete") {
    enforceTab(tab).catch(console.error);
  }
});

browser.tabs.onRemoved.addListener(() => {
  scheduleTrackingReconcile();
});

browser.windows.onFocusChanged.addListener(() => {
  enforceFocusedTab().catch(console.error);
  updateActiveTabBadge().catch(console.error);
  scheduleTrackingReconcile();
});

browser.windows.onRemoved.addListener(() => {
  scheduleTrackingReconcile();
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes[SETTINGS_KEY] || changes[ACCESS_KEY])) {
    updateActiveTabBadge().catch(console.error);
    scheduleTrackingReconcile();
  }
});

async function restoreAccessAlarms() {
  const { settings, accessUntilBySiteId } = await readState();

  for (const [accessKey, accessUntilValue] of Object.entries(accessUntilBySiteId)) {
    const accessUntil = Number(accessUntilValue) || 0;
    if (isKnownAccessKey(accessKey, settings) && Date.now() < accessUntil) {
      browser.alarms.create(`${ALARM_PREFIX}${accessKey}`, { when: accessUntil });
    } else {
      delete accessUntilBySiteId[accessKey];
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
