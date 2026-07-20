const { calculateEarnedSeconds } = FinallyGoodBlockerScheme;

const holdButton = document.querySelector("#hold-button");

const query = new URLSearchParams(location.search);
const siteId = query.get("site");
const requestedTargetUrl = query.get("target");

let site;
let targetUrl;
let heldSince = null;
let unlocking = false;

function resetButton() {
  heldSince = null;
}

function beginHold(event) {
  if (!site || unlocking || heldSince != null) {
    return;
  }

  if (event.type === "pointerdown" && event.button !== 0) {
    return;
  }

  event.preventDefault();
  if (event.pointerId != null) {
    holdButton.setPointerCapture(event.pointerId);
  }
  heldSince = performance.now();
}

async function finishHold(event, cancelled = false) {
  if (heldSince == null || unlocking) {
    return;
  }

  event?.preventDefault();
  const heldMilliseconds = performance.now() - heldSince;
  const earnedSeconds = calculateEarnedSeconds(heldMilliseconds, site.scheme);

  if (cancelled || earnedSeconds <= 0) {
    resetButton();
    return;
  }

  unlocking = true;

  const response = await browser.runtime.sendMessage({
    type: "unlock-site",
    siteId: site.id,
    targetUrl,
    heldMilliseconds,
  });

  if (!response?.ok) {
    unlocking = false;
    resetButton();
    console.error(response?.error || "Could not unlock this site.");
    return;
  }

  location.replace(response.targetUrl);
}

holdButton.addEventListener("pointerdown", beginHold);
holdButton.addEventListener("pointerup", (event) => finishHold(event));
holdButton.addEventListener("pointercancel", (event) => finishHold(event, true));
holdButton.addEventListener("contextmenu", (event) => event.preventDefault());

holdButton.addEventListener("keydown", (event) => {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    beginHold(event);
  }
});
holdButton.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") {
    finishHold(event);
  }
});

window.addEventListener("blur", (event) => finishHold(event, true));

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.accessUntilBySiteId || !site) {
    return;
  }

  const accessUntil = Number(changes.accessUntilBySiteId.newValue?.[site.id]) || 0;
  if (Date.now() < accessUntil) {
    location.replace(targetUrl);
  }
});

async function start() {
  if (!siteId || !requestedTargetUrl) {
    throw new Error("This blocking page is missing its original destination.");
  }

  const response = await browser.runtime.sendMessage({
    type: "get-blocked-page-state",
    siteId,
    targetUrl: requestedTargetUrl,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not load the blocking rule.");
  }

  site = response.site;
  targetUrl = response.targetUrl;

  if (Date.now() < response.accessUntil) {
    location.replace(targetUrl);
    return;
  }
}

start().catch((error) => {
  holdButton.disabled = true;
  console.error(error);
});
