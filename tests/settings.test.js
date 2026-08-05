const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALLOWLIST_MODE,
  BLOCKLIST_MODE,
  normalizeSettings,
} = require("../shared/settings.js");

test("new settings begin in blocklist mode with separate empty lists", () => {
  assert.deepEqual(normalizeSettings(), {
    version: 2,
    mode: BLOCKLIST_MODE,
    blocklistSites: [],
    allowlistSites: [],
  });
});

test("version 1 sites migrate into blocklist mode", () => {
  const migrated = normalizeSettings({
    version: 1,
    sites: [{ id: "reddit", hostname: "Reddit.com", scheme: { baseAccessSeconds: 45 } }],
  });

  assert.equal(migrated.mode, BLOCKLIST_MODE);
  assert.equal(migrated.blocklistSites[0].hostname, "reddit.com");
  assert.equal(migrated.blocklistSites[0].scheme.baseAccessSeconds, 45);
  assert.deepEqual(migrated.allowlistSites, []);
});

test("version 2 keeps both modes' independent lists", () => {
  const normalized = normalizeSettings({
    version: 2,
    mode: ALLOWLIST_MODE,
    blocklistSites: [{ id: "blocked", hostname: "social.example" }],
    allowlistSites: [{ id: "allowed", hostname: "work.example" }],
    allowlistAccessRules: [{ id: "old-custom", hostname: "news.example" }],
  });

  assert.equal(normalized.mode, ALLOWLIST_MODE);
  assert.equal(normalized.blocklistSites[0].hostname, "social.example");
  assert.equal(normalized.allowlistSites[0].hostname, "work.example");
  assert.equal("allowlistAccessRules" in normalized, false);
});

test("normalization removes duplicate hostnames within each list", () => {
  const normalized = normalizeSettings({
    version: 2,
    mode: ALLOWLIST_MODE,
    allowlistSites: [
      { id: "first", hostname: "example.com" },
      { id: "second", hostname: "EXAMPLE.COM." },
    ],
  });

  assert.equal(normalized.allowlistSites.length, 1);
  assert.equal(normalized.allowlistSites[0].id, "first");
});
