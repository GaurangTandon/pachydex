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

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Status mapping from extension badge to UI display
const STATUS_MAP = {
  '⏳': {
    icon: '⏱️',
    text: 'Waiting 30 seconds before saving...',
    state: 'status-waiting'
  },
  '✓': {
    icon: '✅',
    text: 'Page saved successfully',
    state: 'status-success'
  },
  '⟳': {
    icon: '⏳',
    text: 'Saving page...',
    state: 'status-saving'
  },
  'x': {
    icon: '🚫',
    text: '',
    state: 'status-error'
  },
};

function updateStatus(statusText, statusTitle) {
  const statusContent = document.getElementById('statusContent');
  const statusIcon = document.getElementById('statusIcon');
  const statusTextEl = document.getElementById('statusText');

  const status = STATUS_MAP[statusText] || {
    icon: '️🏠',
    text: 'This is your Pachydex homepage',
    state: 'status-idle'
  };
  if (statusTitle) {
    status.text = statusTitle;
  }

  statusIcon.textContent = status.icon;
  statusTextEl.textContent = status.text;

  // Remove all status classes
  statusContent.className = 'status-content';
  // Add the appropriate status class
  statusContent.classList.add(status.state);
}

async function updateUI() {
  const tab = await getCurrentTab();
  const origin = getOrigin(tab.url);

  if (!origin) {
    updateStatus('Cannot manage this page');
    document.getElementById("settingsSection").classList.add("hidden");
    return;
  }

  // Get and display current status from badge
  const badgeText = (await chrome.action.getBadgeText({ tabId: tab.id }))?.[0];
  const badgeTitle = (await chrome.action.getTitle({ tabId: tab.id }));
  updateStatus(badgeText, badgeTitle);

  // Update settings section
  const blacklist = await getBlacklist();
  const isBlacklisted = blacklist.includes(origin);

  const settingsSection = document.getElementById("settingsSection");
  const originLabel = document.getElementById("settingsOrigin");
  const toggleButton = document.getElementById("toggleButton");

  settingsSection.classList.remove("hidden");

  // Shorten origin display if too long
  const displayOrigin = origin.length > 30 ? origin.substring(0, 27) + '...' : origin;
  originLabel.textContent = displayOrigin;
  originLabel.title = origin; // Show full origin on hover

  if (isBlacklisted) {
    toggleButton.textContent = "Enable indexing";
    toggleButton.className = "toggle-button disabled";
  } else {
    toggleButton.textContent = "Disable indexing";
    toggleButton.className = "toggle-button enabled";
  }
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

// Event listeners
document
  .getElementById("toggleButton")
  .addEventListener("click", toggleBlacklist);

document
  .getElementById("summariesButton")
  .addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/summary_view/index.html") });
  });

// Initialize UI
updateUI();
