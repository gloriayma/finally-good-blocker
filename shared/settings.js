(function exposeSettingsTools(scope) {
  const SETTINGS_VERSION = 2;
  const BLOCKLIST_MODE = "blocklist";
  const ALLOWLIST_MODE = "allowlist";

  function normalizeStoredHostname(value) {
    return typeof value === "string"
      ? value.trim().toLowerCase().replace(/\.$/, "")
      : "";
  }

  function normalizeSites(candidates, { withScheme, idPrefix }) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    const seenHostnames = new Set();
    const sites = [];

    for (const candidate of candidates) {
      const hostname = normalizeStoredHostname(candidate?.hostname);
      if (!hostname || seenHostnames.has(hostname)) {
        continue;
      }

      seenHostnames.add(hostname);
      const savedId = typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `${idPrefix}:${hostname}`;
      const site = { id: savedId, hostname };

      if (withScheme) {
        site.scheme = candidate.scheme || {};
      }

      sites.push(site);
    }

    return sites;
  }

  function normalizeSettings(candidate) {
    const source = candidate && typeof candidate === "object" ? candidate : {};

    // Version 1 had one list named `sites`. Migrating it into blocklist mode
    // preserves every existing user's behavior until they explicitly switch.
    if (source.version !== SETTINGS_VERSION) {
      return {
        version: SETTINGS_VERSION,
        mode: BLOCKLIST_MODE,
        blocklistSites: normalizeSites(source.sites, {
          withScheme: true,
          idPrefix: "blocklist",
        }),
        allowlistSites: [],
      };
    }

    return {
      version: SETTINGS_VERSION,
      mode: source.mode === ALLOWLIST_MODE ? ALLOWLIST_MODE : BLOCKLIST_MODE,
      blocklistSites: normalizeSites(source.blocklistSites, {
        withScheme: true,
        idPrefix: "blocklist",
      }),
      allowlistSites: normalizeSites(source.allowlistSites, {
        withScheme: false,
        idPrefix: "allowlist",
      }),
    };
  }

  const tools = {
    SETTINGS_VERSION,
    BLOCKLIST_MODE,
    ALLOWLIST_MODE,
    normalizeSettings,
  };
  scope.FinallyGoodBlockerSettings = tools;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = tools;
  }
})(globalThis);
