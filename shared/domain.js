(function exposeDomainTools(scope) {
  function normalizeHostnameInput(rawValue) {
    let value = String(rawValue || "").trim().toLowerCase();

    if (!value) {
      throw new Error("Enter a domain, such as reddit.com.");
    }

    // Let people paste either a bare domain or a complete URL. The blocker only
    // stores the hostname: schemes, paths, queries, fragments, and ports are not
    // part of a site rule.
    if (!value.includes("://")) {
      value = `https://${value}`;
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("That does not look like a valid domain or URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS sites can be blocked.");
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname) {
      throw new Error("That URL does not contain a hostname.");
    }

    return hostname;
  }

  function hostnameMatchesSite(hostname, siteHostname) {
    const current = String(hostname || "").toLowerCase().replace(/\.$/, "");
    const rule = String(siteHostname || "").toLowerCase().replace(/\.$/, "");

    // The dot in `.${rule}` is important. It makes old.reddit.com match
    // reddit.com without also making notreddit.com match reddit.com.
    return current === rule || current.endsWith(`.${rule}`);
  }

  const tools = { normalizeHostnameInput, hostnameMatchesSite };
  scope.FinallyGoodBlockerDomain = tools;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = tools;
  }
})(globalThis);
