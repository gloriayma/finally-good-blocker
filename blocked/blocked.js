const { calculateEarnedSeconds } = FinallyGoodBlockerScheme;

const hostnameElement = document.querySelector("#hostname");
const thresholdElement = document.querySelector("#threshold");
const baseAccessElement = document.querySelector("#base-access");
const extraRateElement = document.querySelector("#extra-rate");
const holdButton = document.querySelector("#hold-button");
const holdFill = document.querySelector("#hold-fill");
const holdLabel = document.querySelector("#hold-label");
const message = document.querySelector("#message");
const openSettings = document.querySelector("#open-settings");

const query = new URLSearchParams(location.search);
const siteId = query.get("site");
const requestedTargetUrl = query.get("target");

let site;
let targetUrl;
let heldSince = null;
let animationFrame = null;
let unlocking = false;

function displayDuration(seconds) {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function resetButton() {
  heldSince = null;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  holdFill.style.transform = "scaleX(0)";
  holdButton.classList.remove("is-ready");
  holdLabel.textContent = "press and hold";
}

function updateWhileHeld() {
  if (heldSince == null || !site) {
    return;
  }

  const heldMilliseconds = performance.now() - heldSince;
  const heldSeconds = heldMilliseconds / 1000;
  const threshold = site.scheme.holdThresholdSeconds;
  const initialProgress = Math.min(heldSeconds / threshold, 1);
  const earnedSeconds = calculateEarnedSeconds(heldMilliseconds, site.scheme);

  holdFill.style.transform = `scaleX(${initialProgress})`;

  if (earnedSeconds === 0) {
    const remaining = Math.max(1, Math.ceil(threshold - heldSeconds));
    holdLabel.textContent = `keep holding · ${remaining}s`;
  } else {
    holdButton.classList.add("is-ready");
    holdLabel.textContent = `release for ${displayDuration(earnedSeconds)}`;
  }

  animationFrame = requestAnimationFrame(updateWhileHeld);
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
  message.textContent = "Stay with the choice.";
  updateWhileHeld();
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
    message.textContent = "Not unlocked. Releasing early does nothing.";
    return;
  }

  unlocking = true;
  holdLabel.textContent = "opening…";

  const response = await browser.runtime.sendMessage({
    type: "unlock-site",
    siteId: site.id,
    targetUrl,
    heldMilliseconds,
  });

  if (!response?.ok) {
    unlocking = false;
    resetButton();
    message.className = "status error";
    message.textContent = response?.error || "Could not unlock this site.";
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

openSettings.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

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

  hostnameElement.textContent = site.hostname;
  thresholdElement.textContent = displayDuration(site.scheme.holdThresholdSeconds);
  baseAccessElement.textContent = displayDuration(site.scheme.baseAccessSeconds);
  extraRateElement.textContent = `${displayDuration(
    site.scheme.accessSecondsPerExtraHoldSecond,
  )} more`;
}

start().catch((error) => {
  holdButton.disabled = true;
  message.className = "status error";
  message.textContent = error.message;
});
