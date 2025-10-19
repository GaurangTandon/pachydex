async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getBlacklist() {
  const result = await chrome.storage.local.get("blacklist");
  return result.blacklist || [];
}

async function setBlacklist(blacklist) {
  await chrome.storage.local.set({ blacklist });
}

async function getLanguage() {
  const result = await chrome.storage.local.get("language");
  return result.language || "en";
}

async function setLanguage(language) {
  await chrome.storage.local.set({ language });
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function updateUI() {
  const tab = await getCurrentTab();
  const origin = getOrigin(tab.url);

  if (!origin) {
    document.getElementById("status").textContent = "Cannot manage this page";
    document.getElementById("toggleButton").style.display = "none";
    return;
  }

  const blacklist = await getBlacklist();
  const isBlacklisted = blacklist.includes(origin);

  const statusEl = document.getElementById("status");
  const buttonEl = document.getElementById("toggleButton");
  const urlEl = document.getElementById("url");

  if (isBlacklisted) {
    statusEl.textContent = "🚫 Predictions disabled";
    statusEl.className = "status disabled";
    buttonEl.textContent = "Enable Predictions";
    buttonEl.className = "enable";
  } else {
    statusEl.textContent = "✓ Predictions enabled";
    statusEl.className = "status enabled";
    buttonEl.textContent = "Disable Predictions";
    buttonEl.className = "disable";
  }

  urlEl.textContent = "Origin: " + origin;

  const language = await getLanguage();
  document.getElementById("languageSelect").value = language;
}

async function toggleBlacklist() {
  const tab = await getCurrentTab();
  const origin = getOrigin(tab.url);

  if (!origin) return;

  const blacklist = await getBlacklist();
  const index = blacklist.indexOf(origin);

  if (index > -1) {
    blacklist.splice(index, 1);
  } else {
    blacklist.push(origin);
  }

  await setBlacklist(blacklist);
  await updateUI();

  // Notify content script about the change
  chrome.tabs.sendMessage(tab.id, {
    type: "blacklistUpdated",
    isBlacklisted: index === -1,
  });
}

document
  .getElementById("toggleButton")
  .addEventListener("click", toggleBlacklist);

document
  .getElementById("languageSelect")
  .addEventListener("change", async (e) => {
    await setLanguage(e.target.value);
  });

document
  .getElementById("summariesButton")
  .addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/summary_view/index.html") });
  });

updateUI();
