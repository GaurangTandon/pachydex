import { userSummariesDb } from "../utils/indexeddb.js";

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

async function updateStatus(statusText, statusTitle, tabUrl, hasCaptcha) {
  const isHomePage = tabUrl.includes('chrome-extension://ocmkjnimcaoagbfhmobfnjefjkclhham/src/summary_view/index.html');
  const statusContent = document.getElementById('statusContent');
  const statusIcon = document.getElementById('statusIcon');
  const statusTextEl = document.getElementById('statusText');

  const status = STATUS_MAP[statusText] || {
    icon: isHomePage ? '️🏠' : '⏸️',
    text: isHomePage ? 'This is your Pachydex homepage' : 'Unknown page',
    state: 'status-idle'
  };
  if (statusTitle) {
    status.text = statusTitle;
  }

  hasCaptcha &&= statusText === '⟳' || statusText === '⏳';
  statusIcon.textContent = status.icon;
  statusTextEl.textContent = hasCaptcha ? 'Waiting for you to solve the captcha...' : status.text;

  // Clear any existing summary display
  const existingSummary = document.querySelector('.summary-display');
  if (existingSummary) {
    existingSummary.remove();
  }

  if (statusText === '✓') {
    const summary = (await (userSummariesDb.getAll())).find(x => x.url === tabUrl);
    if (summary) {
      // Create tags HTML
      const tagsHtml = summary.tags
        .map(tag => `<span class="summary-tag">${tag.replace(/_/g, ' ')}</span>`)
        .join('');

      // Create takeaways HTML
      const takeawaysHtml = summary.takeaways
        .map(takeaway => `<div class="summary-takeaway-item">${takeaway}</div>`)
        .join('');

      // Create summary display element
      const summaryDisplay = document.createElement('div');
      summaryDisplay.className = 'summary-display';
      summaryDisplay.innerHTML = `
        ${summary.tags.length > 0 ? `<div class="summary-tags">${tagsHtml}</div>` : ''}
        <div class="summary-takeaways">
          <div class="summary-takeaways-title">Key Takeaways</div>
          ${takeawaysHtml}
        </div>
      `;

      // Insert after the status card
      const statusCard = document.querySelector('.status-card');
      statusCard.parentNode.insertBefore(summaryDisplay, statusCard.nextSibling);
    }
  }

  // Remove all status classes
  statusContent.className = 'status-content';
  // Add the appropriate status class
  statusContent.classList.add(status.state);
}

async function updateUI() {
  const tab = await getCurrentTab();
  const origin = getOrigin(tab.url);

  if (!origin) {
    await updateStatus('Cannot manage this page');
    document.getElementById("settingsSection").classList.add("hidden");
    return;
  }

  // Get and display current status from badge
  const badgeText = (await chrome.action.getBadgeText({ tabId: tab.id }))?.[0];
  const badgeTitle = (await chrome.action.getTitle({ tabId: tab.id }));
  const hasCaptcha = (await chrome.tabs.sendMessage(tab.id, { type: 'isCaptcha' }, { frameId: 0, }))?.blockedOnCaptcha;
  await updateStatus(badgeText, badgeTitle, tab.url, hasCaptcha);

  // Update settings section
  const blacklist = await getBlacklist();
  const isBlacklisted = blacklist.includes(origin);

  const settingsSection = document.getElementById("settingsSection");
  const originLabel = document.getElementById("settingsOrigin");
  const toggleButton = document.getElementById("toggleButton");

  settingsSection.classList.remove("hidden");

  // Shorten origin display if too long
  const displayOrigin = origin; // origin.length > 30 ? origin.substring(0, 27) + '...' : origin;
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
