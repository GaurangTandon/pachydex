import { getCSTimeSpent, getNormalizedURL, INACCESSIBLE_REASON, getCacheWrittenToDB, isCSActive, resetBadge, setResultBadge, setTitleTextAndColor, getAndStoreAvailableCachePromise, populateCache, SAVING_REASON } from "./bg.js";
import { initEmbeddingProcessor } from "./embedding-processor.js";

// Initialize embedding processor
initEmbeddingProcessor();

// Listen for language message from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getLanguage") {
    chrome.storage.local.get("language", (result) => {
      let lang = result.language;
      if (!lang) {
        // Determine preferred language: 'es' or 'ja', else default to 'en'
        const langNav = navigator.language;
        if (langNav.startsWith('es')) {
          lang = 'es';
        } else if (langNav.startsWith('ja')) {
          lang = 'ja';
        } else {
          lang = 'en';
        }
      }
      sendResponse({ language: lang });
    });
    // Return true to indicate async response
    return true;
  }
});

// Open home page on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/summary_view/index.html')
    });
  }
});

/** @type {{ timeout: NodeJS.Timeout, tabId: number, url: string, endTime: number, }} */
let previousWait = null;
function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
async function getBlacklist() {
  const result = await chrome.storage.local.get("blacklist");
  return result.blacklist || [];
}

/**
 * don't update badge if page is different now than when we started the computation
 * @param {number} tabId 
 * @param {string} normalizedUrl 
 * @param {Parameters<typeof setResultBadge>[1]} result 
 */
async function setBadgeWithWaitCheck(tabId, normalizedUrl, result) {
  const tab = await getActiveTab();
  if (tab?.id === tabId) {
    if (getNormalizedURL(tab.url) === normalizedUrl) {
      setResultBadge(tabId, result);
    }
  }
}

const MIN_TIME_REQUIRED_MS = 10_000;
const getActiveTab = async () =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
async function runner() {
  const tab = await getActiveTab();
  const data = { tabId: tab?.id, windowId: tab?.windowId, url: tab?.url, title: tab?.title, };
  // const WAIT_TEXT = 'Waiting for you to spend over thirty seconds on this page, before we save this page.';
  console.debug('Runner data', data);
  if (!data.tabId) {
    // show failed badge info - don't set any badge info because tab id is missing
    // setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    clearTimeout(previousWait?.timeout);
    previousWait = null;
    return;
  }
  const tabNormalizedURL = getNormalizedURL(data.url);
  if (!tabNormalizedURL) {
    console.debug('Runner exit on invalid URL', data.url);
    setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    clearTimeout(previousWait?.timeout);
    previousWait = null;
    return;
  }
  if (previousWait?.timeout) {
    if (data.tabId === previousWait.tabId && previousWait.url === tabNormalizedURL) {
      console.debug('Runner update ignored as already waiting on same tab');
      setTitleTextAndColor(data.tabId, 'waiting', previousWait.endTime.toString());
      // we got an event elsewhere while we're still waiting for the same active tab
      // ignore the event
      return;
    }
    console.debug('Runner cleared previous wait timeout, will check new');
    // clear the timer on the active tab as now we'll be looking at some other active tab
    clearTimeout(previousWait.timeout);
    previousWait = null;
  }
  if (!(await isCSActive(data.tabId))) {
    // show failed badge info
    console.debug("Runner exit because CS inactive", data.url);
    if (data.url.startsWith('chrome-extension://') && data.url.endsWith('summary_view/index.html')) {
      // don't show badge on the extension's own page haha
      resetBadge(data.tabId);
    } else {
      setTitleTextAndColor(data.tabId, "fail", INACCESSIBLE_REASON);
    }
    return;
  }
  const blacklist = await getBlacklist();
  const origin = getOrigin(data.url);
  if (blacklist.includes(origin)) {
    console.debug("Runner exit as origin is in blacklist", blacklist, origin)
    setTitleTextAndColor(data.tabId, "fail", 'you have disabled indexing on this webpage');
    return;
  }
  const cacheWrittenResult = getCacheWrittenToDB(data.tabId, data.url);
  if (cacheWrittenResult) {
    console.debug("Runner setting from direct cache", data.tabId, data.url)
    setResultBadge(data.tabId, cacheWrittenResult);
    return;
  }
  const timeSpent = await getCSTimeSpent(data.tabId);
  const timeRemaining = MIN_TIME_REQUIRED_MS - timeSpent;
  if (timeRemaining <= 0) {
    console.debug("Runner run immediately");
    setTitleTextAndColor(data.tabId, "pending", SAVING_REASON);
    // must store the result now, if it's not available, populate it but must store it
    let resultFromPromise = await getAndStoreAvailableCachePromise(data.tabId, data.title, data.url);
    if (resultFromPromise) {
      // result may be missing in case user switched multiple tabs and this tab's prompt session got removed from LRU cache
      setBadgeWithWaitCheck(data.tabId, tabNormalizedURL, resultFromPromise);
      return;
    }
    const tab = await getActiveTab();
    // if we're still the active tab, try to populate the cache again
    if (tab?.id === data.tabId) {
      if (getNormalizedURL(tab.url) === tabNormalizedURL) {
        // populate cache and try again
        populateCache(data.tabId, data.windowId, data.url);
        resultFromPromise = await getAndStoreAvailableCachePromise(data.tabId, data.title, data.url);
        if (resultFromPromise) {
          // result may be missing in case user switched multiple tabs and this tab's prompt session got removed from LRU cache
          setBadgeWithWaitCheck(data.tabId, tabNormalizedURL, resultFromPromise);
          return;
        }
      }
    }
    // some strange problem if failed again
  } else {
    console.debug("Runner waiting for timeout", timeRemaining);
    let endTime = Date.now() + timeRemaining;
    const myInterval = setInterval(() => {
      if (previousWait?.timeout === myInterval) {
        if (Date.now() >= endTime) {
          clearInterval(previousWait.timeout);
          console.debug('Timeout finished');
          previousWait = null;
          runner();
        } else {
          // Update badge text
          setTitleTextAndColor(data.tabId, 'waiting', previousWait.endTime.toString());
        }
      } else {
        // won't do anything if already cleared
        clearInterval(myInterval);
      }
    }, 1000);
    previousWait = {
      tabId: data.tabId,
      timeout: myInterval,
      url: tabNormalizedURL,
      endTime
    }
    setTitleTextAndColor(data.tabId, 'waiting', previousWait.endTime.toString());
    populateCache(data.tabId, data.windowId, data.url);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    // Only fires for the root frame
    runner();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  runner();
});

chrome.tabs.onActivated.addListener(() => {
  runner();
});

chrome.tabs.query({}).then(tabs => {
  tabs.forEach(async (tab) => {
    if (!(await isCSActive(tab.id))) {
      chrome.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true,
        },
        files: ['src/content.js'],
      }).catch(() => { });
    }
  });

  // run once at start
  setTimeout(runner, 1000);
})