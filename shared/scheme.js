(function exposeSchemeTools(scope) {
  const DEFAULT_SCHEME = Object.freeze({
    holdThresholdSeconds: 10,
    baseAccessSeconds: 30,
    accessSecondsPerExtraHoldSecond: 5,
  });

  function numberOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function cleanScheme(candidate) {
    const source = candidate || {};
    return {
      holdThresholdSeconds: Math.max(
        1,
        Math.round(
          numberOrDefault(
            source.holdThresholdSeconds,
            DEFAULT_SCHEME.holdThresholdSeconds,
          ),
        ),
      ),
      baseAccessSeconds: Math.max(
        1,
        Math.round(numberOrDefault(source.baseAccessSeconds, DEFAULT_SCHEME.baseAccessSeconds)),
      ),
      accessSecondsPerExtraHoldSecond: Math.max(
        0,
        Math.round(
          numberOrDefault(
            source.accessSecondsPerExtraHoldSecond,
            DEFAULT_SCHEME.accessSecondsPerExtraHoldSecond,
          ),
        ),
      ),
    };
  }

  function calculateEarnedSeconds(heldMilliseconds, candidateScheme) {
    const scheme = cleanScheme(candidateScheme);
    const heldSeconds = Math.max(0, Number(heldMilliseconds) || 0) / 1000;

    if (heldSeconds < scheme.holdThresholdSeconds) {
      return 0;
    }

    const extraHoldSeconds = heldSeconds - scheme.holdThresholdSeconds;
    return Math.floor(
      scheme.baseAccessSeconds +
        extraHoldSeconds * scheme.accessSecondsPerExtraHoldSecond,
    );
  }

  const tools = { DEFAULT_SCHEME, cleanScheme, calculateEarnedSeconds };
  scope.FinallyGoodBlockerScheme = tools;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = tools;
  }
})(globalThis);
