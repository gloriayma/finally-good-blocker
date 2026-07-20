const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SCHEME,
  calculateEarnedSeconds,
  cleanScheme,
} = require("../shared/scheme.js");

test("uses the requested defaults", () => {
  assert.deepEqual(DEFAULT_SCHEME, {
    holdThresholdSeconds: 10,
    baseAccessSeconds: 30,
    accessSecondsPerExtraHoldSecond: 5,
  });
});

test("earns nothing before the threshold", () => {
  assert.equal(calculateEarnedSeconds(9_999, DEFAULT_SCHEME), 0);
});

test("earns base access at the threshold", () => {
  assert.equal(calculateEarnedSeconds(10_000, DEFAULT_SCHEME), 30);
});

test("earns five access seconds per extra hold second", () => {
  assert.equal(calculateEarnedSeconds(11_000, DEFAULT_SCHEME), 35);
  assert.equal(calculateEarnedSeconds(15_000, DEFAULT_SCHEME), 55);
});

test("floors partial earned seconds", () => {
  assert.equal(calculateEarnedSeconds(10_999, DEFAULT_SCHEME), 34);
});

test("allows a zero post-threshold rate", () => {
  const scheme = cleanScheme({
    holdThresholdSeconds: 3,
    baseAccessSeconds: 20,
    accessSecondsPerExtraHoldSecond: 0,
  });
  assert.equal(calculateEarnedSeconds(20_000, scheme), 20);
});
