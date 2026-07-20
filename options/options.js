const { normalizeHostnameInput } = FinallyGoodBlockerDomain;
const { DEFAULT_SCHEME, cleanScheme } = FinallyGoodBlockerScheme;

const SETTINGS_KEY = "settings";
const ACCESS_KEY = "accessUntilBySiteId";
const TRACKED_SITES_KEY = "trackedSites";
const ALARM_PREFIX = "access-expired:";

const addForm = document.querySelector("#add-site-form");
const siteInput = document.querySelector("#site-input");
const formStatus = document.querySelector("#form-status");
const siteList = document.querySelector("#site-list");

let settings = { version: 1, sites: [] };

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function saveSettings() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

function numericInput(labelText, value, allowZero, onChange) {
  const input = document.createElement("input");

  // This is deliberately a text input with a numeric keyboard hint. Native
  // number inputs add spinner arrows that cannot be styled consistently.
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = allowZero ? "[0-9]+" : "[1-9][0-9]*";
  input.className = "scheme-input";
  input.setAttribute("aria-label", `${labelText} in seconds`);
  input.value = String(value);
  input.addEventListener("change", () => onChange(input.value));

  return input;
}

function renderSites() {
  siteList.replaceChildren();

  if (settings.sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sites yet.";
    siteList.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "sites-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["site", "hold", "base", "extra", ""]) {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = label;
    headRow.append(heading);
  }
  head.append(headRow);

  const body = document.createElement("tbody");

  for (const site of settings.sites) {
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
        renderSites();
      }),
    );

    const baseAccessCell = document.createElement("td");
    baseAccessCell.append(
      numericInput("base access", site.scheme.baseAccessSeconds, false, async (value) => {
        site.scheme.baseAccessSeconds = Number(value);
        site.scheme = cleanScheme(site.scheme);
        await saveSettings();
        renderSites();
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
          renderSites();
        },
      ),
    );

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger-button";
    removeButton.textContent = "remove";
    removeButton.addEventListener("click", async () => {
      settings.sites = settings.sites.filter((candidate) => candidate.id !== site.id);
      await saveSettings();

      const stored = await browser.storage.local.get(ACCESS_KEY);
      const accessUntilBySiteId = stored[ACCESS_KEY] || {};
      delete accessUntilBySiteId[site.id];
      await browser.storage.local.set({ [ACCESS_KEY]: accessUntilBySiteId });
      await browser.alarms.clear(`${ALARM_PREFIX}${site.id}`);

      // Removing a rule stops blocking only. Its hostname stays in the separate
      // tracking list, and its host permission stays granted so Firefox can
      // continue reporting active visits to this site.
      renderSites();
    });

    const removeCell = document.createElement("td");
    removeCell.className = "remove-cell";
    removeCell.append(removeButton);

    row.append(hostnameCell, holdCell, baseAccessCell, extraAccessCell, removeCell);
    body.append(row);
  }

  table.append(head, body);
  siteList.append(table);
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.className = "status";
  formStatus.textContent = "";

  let hostname;
  try {
    hostname = normalizeHostnameInput(siteInput.value);
  } catch (error) {
    formStatus.className = "status error";
    formStatus.textContent = error.message;
    return;
  }

  if (settings.sites.some((site) => site.hostname === hostname)) {
    formStatus.className = "status error";
    formStatus.textContent = `${hostname} is already in the list.`;
    return;
  }

  // The wildcard begins with a dot, so Firefox grants this exact hostname and
  // its subdomains. It does not grant access to unrelated suffix lookalikes.
  const originPattern = `*://*.${hostname}/*`;
  let permissionGranted = false;
  try {
    permissionGranted = await browser.permissions.request({ origins: [originPattern] });
  } catch {
    formStatus.className = "status error";
    formStatus.textContent = "Firefox could not request access to that hostname.";
    return;
  }

  if (!permissionGranted) {
    formStatus.className = "status error";
    formStatus.textContent = "The site was not added because hostname access was declined.";
    return;
  }

  settings.sites.push({
    id: makeId(),
    hostname,
    scheme: { ...DEFAULT_SCHEME },
  });

  const storedTracking = await browser.storage.local.get(TRACKED_SITES_KEY);
  const trackedHostnames = Array.isArray(storedTracking[TRACKED_SITES_KEY]?.hostnames)
    ? storedTracking[TRACKED_SITES_KEY].hostnames
    : [];

  await browser.storage.local.set({
    [SETTINGS_KEY]: settings,
    [TRACKED_SITES_KEY]: {
      version: 1,
      hostnames: [...new Set([...trackedHostnames, hostname])],
    },
  });
  siteInput.value = "";
  renderSites();
});

async function start() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  if (stored[SETTINGS_KEY]?.version === 1 && Array.isArray(stored[SETTINGS_KEY].sites)) {
    settings = stored[SETTINGS_KEY];
  }
  renderSites();
}

start().catch((error) => {
  formStatus.className = "status error";
  formStatus.textContent = `Could not load settings: ${error.message}`;
});
