const { normalizeHostnameInput } = FinallyGoodBlockerDomain;
const { DEFAULT_SCHEME, cleanScheme } = FinallyGoodBlockerScheme;

const SETTINGS_KEY = "settings";
const ACCESS_KEY = "accessUntilBySiteId";
const ALARM_PREFIX = "access-expired:";

const addForm = document.querySelector("#add-site-form");
const siteInput = document.querySelector("#site-input");
const formStatus = document.querySelector("#form-status");
const saveStatus = document.querySelector("#save-status");
const siteList = document.querySelector("#site-list");

let settings = { version: 1, sites: [] };
let savedStatusTimer;

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function saveSettings() {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  saveStatus.textContent = "saved";
  clearTimeout(savedStatusTimer);
  savedStatusTimer = setTimeout(() => {
    saveStatus.textContent = "";
  }, 1400);
}

function numberField(labelText, value, onChange) {
  const label = document.createElement("label");
  const labelSpan = document.createElement("span");
  const input = document.createElement("input");

  labelSpan.textContent = labelText;
  input.type = "number";
  input.min = labelText === "extra access per hold second" ? "0" : "1";
  input.step = "1";
  input.value = String(value);
  input.addEventListener("change", () => onChange(input.value));

  label.append(labelSpan, input);
  return label;
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

  for (const site of settings.sites) {
    site.scheme = cleanScheme(site.scheme);

    const card = document.createElement("article");
    card.className = "site-card";

    const heading = document.createElement("div");
    heading.className = "site-card-heading";

    const hostname = document.createElement("h3");
    hostname.textContent = site.hostname;

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

      // This is the exact permission that was requested when the site was added.
      // Firefox may keep access if a broader, still-saved rule also covers it.
      const originPattern = `*://*.${site.hostname}/*`;
      await browser.permissions.remove({ origins: [originPattern] });
      renderSites();
    });

    heading.append(hostname, removeButton);

    const fields = document.createElement("div");
    fields.className = "scheme-fields";
    fields.append(
      numberField("hold before access (seconds)", site.scheme.holdThresholdSeconds, async (value) => {
        site.scheme.holdThresholdSeconds = Number(value);
        site.scheme = cleanScheme(site.scheme);
        await saveSettings();
        renderSites();
      }),
      numberField("base access (seconds)", site.scheme.baseAccessSeconds, async (value) => {
        site.scheme.baseAccessSeconds = Number(value);
        site.scheme = cleanScheme(site.scheme);
        await saveSettings();
        renderSites();
      }),
      numberField(
        "extra access per hold second",
        site.scheme.accessSecondsPerExtraHoldSecond,
        async (value) => {
          site.scheme.accessSecondsPerExtraHoldSecond = Number(value);
          site.scheme = cleanScheme(site.scheme);
          await saveSettings();
          renderSites();
        },
      ),
    );

    const formula = document.createElement("p");
    formula.className = "formula";
    formula.textContent =
      `Hold ${site.scheme.holdThresholdSeconds}s → ${site.scheme.baseAccessSeconds}s access; ` +
      `then +${site.scheme.accessSecondsPerExtraHoldSecond}s access for every extra second held.`;

    card.append(heading, fields, formula);
    siteList.append(card);
  }
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
  await saveSettings();
  siteInput.value = "";
  formStatus.textContent = `${hostname} is now blocked.`;
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
