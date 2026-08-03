const { normalizeHostnameInput } = FinallyGoodBlockerDomain;
const { DEFAULT_SCHEME, cleanScheme } = FinallyGoodBlockerScheme;
const {
  BLOCKLIST_MODE,
  ALLOWLIST_MODE,
  normalizeSettings,
} = FinallyGoodBlockerSettings;

const SETTINGS_KEY = "settings";
const ACCESS_KEY = "accessUntilBySiteId";
const ALARM_PREFIX = "access-expired:";
const ALL_SITES_PATTERN = "*://*/*";

const modeSwitch = document.querySelector("#mode-switch");
const modeToggle = document.querySelector("#mode-toggle");
const modeStatus = document.querySelector("#mode-status");
const addHeading = document.querySelector("#add-heading");
const addForm = document.querySelector("#add-site-form");
const siteInput = document.querySelector("#site-input");
const formStatus = document.querySelector("#form-status");
const sitesHeading = document.querySelector("#sites-heading");
const siteList = document.querySelector("#site-list");
const customRules = document.querySelector("#custom-rules");
const addRuleForm = document.querySelector("#add-rule-form");
const ruleInput = document.querySelector("#rule-input");
const ruleStatus = document.querySelector("#rule-status");
const ruleList = document.querySelector("#rule-list");

let settings = normalizeSettings();
let changingMode = false;

async function checkExtensionHealth() {
  let response;
  try {
    response = await browser.runtime.sendMessage({ type: "get-extension-status" });
  } catch {
    response = null;
  }

  if (!response?.ok || response.apiVersion !== 2) {
    showStatus(
      modeStatus,
      "Reload the extension in about:debugging so allowlist blocking can start.",
      true,
    );
    return false;
  }

  if (response.mode !== settings.mode) {
    showStatus(
      modeStatus,
      "The background settings are out of date; reload the extension in about:debugging.",
      true,
    );
    return false;
  }

  if (settings.mode === ALLOWLIST_MODE && !response.hasAllSitesPermission) {
    showStatus(
      modeStatus,
      "Firefox all-sites access is missing; switch away and back to restore it.",
      true,
    );
    return false;
  }

  return true;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function originPatternForHostname(hostname) {
  if (
    hostname === "localhost" ||
    hostname.startsWith("[") ||
    /^\d+(?:\.\d+){3}$/.test(hostname)
  ) {
    return `*://${hostname}/*`;
  }

  return `*://*.${hostname}/*`;
}

async function saveSettings() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

function showStatus(element, message = "", isError = false) {
  element.className = isError ? "status error" : "status";
  element.textContent = message;
}

async function clearTemporaryAccess() {
  const stored = await browser.storage.local.get(ACCESS_KEY);
  const accessUntilBySiteId = stored[ACCESS_KEY] || {};
  await Promise.all(
    Object.keys(accessUntilBySiteId).map((accessKey) =>
      browser.alarms.clear(`${ALARM_PREFIX}${accessKey}`),
    ),
  );
  await browser.storage.local.set({ [ACCESS_KEY]: {} });
}

async function clearAccessForRule(ruleId) {
  const stored = await browser.storage.local.get(ACCESS_KEY);
  const accessUntilBySiteId = stored[ACCESS_KEY] || {};
  delete accessUntilBySiteId[ruleId];
  await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
  await browser.alarms.clear(`${ALARM_PREFIX}${ruleId}`);
}

function numericInput(labelText, value, allowZero, onChange) {
  const input = document.createElement("input");

  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = allowZero ? "[0-9]+" : "[1-9][0-9]*";
  input.className = "scheme-input";
  input.setAttribute("aria-label", `${labelText} in seconds`);
  input.value = String(value);
  input.addEventListener("change", () => onChange(input.value));

  return input;
}

function appendTableHead(table, labels) {
  const head = document.createElement("thead");
  const row = document.createElement("tr");

  for (const label of labels) {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = label;
    row.append(heading);
  }

  head.append(row);
  table.append(head);
}

function makeRemoveButton(onRemove) {
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "danger-button";
  removeButton.textContent = "remove";
  removeButton.addEventListener("click", onRemove);
  return removeButton;
}

function renderRuleTable(container, sites, emptyText, onRemove) {
  container.replaceChildren();

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "sites-table";
  appendTableHead(table, ["site", "hold", "base", "extra", ""]);
  const body = document.createElement("tbody");

  for (const site of sites) {
    site.scheme = cleanScheme(site.scheme);
    const row = document.createElement("tr");
    const hostnameCell = document.createElement("td");
    hostnameCell.className = "hostname-cell";
    hostnameCell.textContent = site.hostname;

    const holdCell = document.createElement("td");
    holdCell.append(
      numericInput("hold", site.scheme.holdThresholdSeconds, false, async (value) => {
        site.scheme.holdThresholdSeconds = Number(value);
        site.scheme = cleanScheme(site.scheme);
        await saveSettings();
        render();
      }),
    );

    const baseAccessCell = document.createElement("td");
    baseAccessCell.append(
      numericInput("base access", site.scheme.baseAccessSeconds, false, async (value) => {
        site.scheme.baseAccessSeconds = Number(value);
        site.scheme = cleanScheme(site.scheme);
        await saveSettings();
        render();
      }),
    );

    const extraAccessCell = document.createElement("td");
    extraAccessCell.append(
      numericInput(
        "extra access per hold second",
        site.scheme.accessSecondsPerExtraHoldSecond,
        true,
        async (value) => {
          site.scheme.accessSecondsPerExtraHoldSecond = Number(value);
          site.scheme = cleanScheme(site.scheme);
          await saveSettings();
          render();
        },
      ),
    );

    const removeCell = document.createElement("td");
    removeCell.className = "remove-cell";
    removeCell.append(makeRemoveButton(() => onRemove(site)));
    row.append(hostnameCell, holdCell, baseAccessCell, extraAccessCell, removeCell);
    body.append(row);
  }

  table.append(body);
  container.append(table);
}

function renderAllowedSites() {
  siteList.replaceChildren();

  if (settings.allowlistSites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sites are allowed.";
    siteList.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "sites-table simple-sites-table";
  appendTableHead(table, ["site", ""]);
  const body = document.createElement("tbody");

  for (const site of settings.allowlistSites) {
    const row = document.createElement("tr");
    const hostnameCell = document.createElement("td");
    hostnameCell.className = "hostname-cell";
    hostnameCell.textContent = site.hostname;
    const removeCell = document.createElement("td");
    removeCell.className = "remove-cell";
    removeCell.append(
      makeRemoveButton(async () => {
        settings.allowlistSites = settings.allowlistSites.filter(
          (candidate) => candidate.id !== site.id,
        );
        await saveSettings();
        render();
      }),
    );
    row.append(hostnameCell, removeCell);
    body.append(row);
  }

  table.append(body);
  siteList.append(table);
}

async function removeBlocklistSite(site) {
  settings.blocklistSites = settings.blocklistSites.filter(
    (candidate) => candidate.id !== site.id,
  );
  await saveSettings();
  await clearAccessForRule(site.id);
  await browser.permissions.remove({
    origins: [originPatternForHostname(site.hostname)],
  });
  render();
}

async function removeCustomRule(site) {
  settings.allowlistAccessRules = settings.allowlistAccessRules.filter(
    (candidate) => candidate.id !== site.id,
  );
  await saveSettings();
  await clearAccessForRule(site.id);
  render();
}

function render() {
  const isAllowlist = settings.mode === ALLOWLIST_MODE;
  modeSwitch.dataset.mode = settings.mode;
  modeToggle.setAttribute("aria-checked", String(isAllowlist));
  modeToggle.setAttribute(
    "aria-label",
    isAllowlist ? "switch to blocklist mode" : "switch to allowlist mode",
  );
  modeToggle.disabled = changingMode;
  addHeading.textContent = isAllowlist ? "add an allowed site" : "add a blocked site";
  sitesHeading.textContent = isAllowlist ? "allowed sites" : "blocked sites";
  customRules.hidden = !isAllowlist;

  if (isAllowlist) {
    renderAllowedSites();
    renderRuleTable(
      ruleList,
      settings.allowlistAccessRules,
      "No custom rules.",
      removeCustomRule,
    );
  } else {
    renderRuleTable(
      siteList,
      settings.blocklistSites,
      "No sites yet.",
      removeBlocklistSite,
    );
  }
}

async function requestHostnamePermission(hostname) {
  try {
    return await browser.permissions.request({
      origins: [originPatternForHostname(hostname)],
    });
  } catch {
    return false;
  }
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(formStatus);

  let hostname;
  try {
    hostname = normalizeHostnameInput(siteInput.value);
  } catch (error) {
    showStatus(formStatus, error.message, true);
    return;
  }

  const collection = settings.mode === ALLOWLIST_MODE
    ? settings.allowlistSites
    : settings.blocklistSites;
  if (collection.some((site) => site.hostname === hostname)) {
    showStatus(formStatus, `${hostname} is already in the list.`, true);
    return;
  }

  if (settings.mode === BLOCKLIST_MODE && !(await requestHostnamePermission(hostname))) {
    showStatus(
      formStatus,
      "The site was not added because hostname access was declined.",
      true,
    );
    return;
  }

  const site = { id: makeId(), hostname };
  if (settings.mode === BLOCKLIST_MODE) {
    site.scheme = { ...DEFAULT_SCHEME };
    settings.blocklistSites.push(site);
  } else {
    settings.allowlistSites.push(site);
  }

  await saveSettings();
  siteInput.value = "";
  render();
});

addRuleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(ruleStatus);

  let hostname;
  try {
    hostname = normalizeHostnameInput(ruleInput.value);
  } catch (error) {
    showStatus(ruleStatus, error.message, true);
    return;
  }

  if (settings.allowlistAccessRules.some((site) => site.hostname === hostname)) {
    showStatus(ruleStatus, `${hostname} already has a custom rule.`, true);
    return;
  }

  settings.allowlistAccessRules.push({
    id: makeId(),
    hostname,
    scheme: { ...DEFAULT_SCHEME },
  });
  await saveSettings();
  ruleInput.value = "";
  render();
});

async function ensureBlocklistPermissions() {
  const origins = settings.blocklistSites.map((site) =>
    originPatternForHostname(site.hostname),
  );
  if (origins.length === 0) {
    return true;
  }

  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

async function selectMode(nextMode) {
  if (changingMode) {
    return;
  }

  changingMode = true;
  showStatus(modeStatus);
  render();

  try {
    if (nextMode === ALLOWLIST_MODE) {
      const granted = await browser.permissions.request({
        origins: [ALL_SITES_PATTERN],
      });
      if (!granted) {
        showStatus(
          modeStatus,
          "Allowlist mode needs Firefox access to all websites.",
          true,
        );
        return;
      }
    } else {
      await browser.permissions.remove({ origins: [ALL_SITES_PATTERN] });
      const restored = await ensureBlocklistPermissions();
      if (!restored) {
        showStatus(
          modeStatus,
          "Blocklist mode is active, but Firefox access is missing for some saved sites.",
          true,
        );
      }
    }

    if (settings.mode !== nextMode) {
      await clearTemporaryAccess();
      settings.mode = nextMode;
      await saveSettings();
    }
  } catch (error) {
    showStatus(modeStatus, `Could not change modes: ${error.message}`, true);
  } finally {
    changingMode = false;
    render();
    await checkExtensionHealth();
  }
}

modeToggle.addEventListener("click", () => {
  selectMode(settings.mode === ALLOWLIST_MODE ? BLOCKLIST_MODE : ALLOWLIST_MODE);
});

async function start() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(stored[SETTINGS_KEY]);

  if (stored[SETTINGS_KEY]?.version !== settings.version) {
    await saveSettings();
  }

  render();
  await checkExtensionHealth();
}

start().catch((error) => {
  showStatus(formStatus, `Could not load settings: ${error.message}`, true);
});
