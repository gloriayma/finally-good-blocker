const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hostnameMatchesSite,
  normalizeHostnameInput,
} = require("../shared/domain.js");

test("normalizes a bare hostname", () => {
  assert.equal(normalizeHostnameInput("  Reddit.COM  "), "reddit.com");
});

test("extracts only the hostname from a complete URL", () => {
  assert.equal(
    normalizeHostnameInput("https://Old.Reddit.com/r/firefox?sort=new#top"),
    "old.reddit.com",
  );
});

test("matches an exact hostname", () => {
  assert.equal(hostnameMatchesSite("reddit.com", "reddit.com"), true);
});

test("matches real subdomains", () => {
  assert.equal(hostnameMatchesSite("old.reddit.com", "reddit.com"), true);
  assert.equal(hostnameMatchesSite("a.b.reddit.com", "reddit.com"), true);
});

test("does not match suffix lookalikes", () => {
  assert.equal(hostnameMatchesSite("notreddit.com", "reddit.com"), false);
  assert.equal(hostnameMatchesSite("reddit.com.example.org", "reddit.com"), false);
});

test("rejects non-web schemes", () => {
  assert.throws(() => normalizeHostnameInput("file:///tmp/page.html"), /HTTP and HTTPS/);
});
