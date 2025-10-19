import { userSummariesDb } from "../utils/indexeddb.js";
import {
  getPrediction,
} from "./ai.js";

const shouldLog = true;
function log(...args) {
  if (shouldLog) {
    console.log(...args);
  }
}

const getActiveTab = () =>
  chrome.tabs.query({ active: true, currentWindow: true });
let lastScreenshot = null;
/**
 * @param {string} imageString
 * @returns {Promise<Blob>}
 */
async function convertImageStringToResizedBlob(
  imageString,
  mimeType = "image/jpeg",
  width = 800,
  height = 600
) {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64String = imageString.replace(/^data:image\/[a-z]+;base64,/, "");

  // Convert base64 to binary string
  const binaryString = atob(base64String);

  // Create array buffer
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  // Fill the array with binary data
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  // Create a blob from the array buffer
  const originalBlob = new Blob([arrayBuffer], { type: mimeType });
  return originalBlob;
}

/**
 *
 * @param {chrome.tabs.Tab} tab
 * @returns
 */
async function getTabScreenshot(tab) {
  if (tab) {
    const windowId = tab.windowId;
    const tabId = tab.id;
    if (
      lastScreenshot &&
      lastScreenshot.tabId === tabId &&
      Date.now() - lastScreenshot.time <= 200
    ) {
      return lastScreenshot.screenshot;
    }
    const image = await chrome.tabs.captureVisibleTab(windowId);
    const blob = await convertImageStringToResizedBlob(
      image,
      "image/jpeg",
      800,
      600
    );
    lastScreenshot = { tabId, time: Date.now(), screenshot: blob };
    return blob;
  }
  return null;
}

// default 0 in case service worker accidentally restarts
let activeFrameId = 0;
/** @type {Object<string, { controller: AbortController, timestamp: number, url: string, }>} */
let pendingRequests = {};
// Cache results in memory to avoid recomputing the summary in the same session for the same pages
const cachedResults = {};

/**
 *
 * @param {number} tabId
 * @param {'success'|'pending'|'fail'} status
 */
function setTextAndColor(tabId, status) {
  let text, color;
  if (status === "fail") {
    text = "x";
    color = "gray";
  } else if (status === "pending") {
    text = "⟳";
    color = "orange";
  } else {
    text = "✓";
    color = "green";
  }
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

const MAX_CONCURRENT_REQUESTS = 3;
export async function gatherInfo() {
  // log("Checking tab if needs prediction");
  const tab = (await getActiveTab())[0];
  if (!tab?.id) {
    log("Exit because invalid tab", tab?.url);
    return;
  }
  const tabId = tab.id,
    frameId = activeFrameId,
    key = tabId + "," + frameId;

  let tabUrlInner;
  try {
    tabUrlInner = new URL(tab.url);
  } catch (e) {
    log('Exit on invalid URL', tab.url);
    return;
  }

  // Remove hash because archive.ph page changes the hash
  // on each mouse selection which can cause multiple summaries
  // for basically the same page
  // Either way hash does not seem worth storing
  tabUrlInner.hash = '';
  const tabURL = tabUrlInner.href;
  if (cachedResults[key]?.url === tabURL) {
    setTextAndColor(tabId, "success");
    log("Exit because already calculated", tabURL);
    return;
  }
  if (pendingRequests[key]?.url === tabURL) {
    log("Exit because already running with the same URL", tabURL);
    return;
  }
  console.log(pendingRequests);
  const controller = new AbortController();
  pendingRequests[key] = { controller, timestamp: Date.now(), url: tabURL };

  const isCsActive = await chrome.tabs
    .sendMessage(tab.id, { type: "isAlive" }, { frameId: activeFrameId })
    .then((x) => !!x?.isAlive)
    .catch(() => false);
  if (!isCsActive) {
    log("Exit because CS inactive", tabURL);
    setTextAndColor(tab.id, "fail");
    delete pendingRequests[key];
    return;
  }
  const hostname = new URL(tabURL).hostname;
  if (
    ["web.whatsapp.com", "mail.google.com", "outlook.live.com"].some((x) =>
      hostname.includes(x)
    )
  ) {
    // Early exit for common pages
    log("Exit because sensitive page", tabURL);
    setTextAndColor(tab.id, "fail");
    delete pendingRequests[key];
  }

  let screenshot = '', documentContent = ['', ''];
  try {
    [screenshot, documentContent] = await Promise.all([
      getTabScreenshot(tab),
      chrome.tabs
        .sendMessage(tabId, { type: "getContent" }, { frameId })
        .then((x) => x.content),
    ]);
  } catch (e) {
    // this can fail if the page redirects after a few seconds like in the case of anubis
  }
  log("Got content from", tabURL, { screenshot, documentContent });
  if (!documentContent?.[0] || !screenshot) {
    setTextAndColor(tabId, "fail");
    delete pendingRequests[key];
    return;
  }
  // Oldest request goes last
  const listOfRequests = Object.entries(pendingRequests).toSorted(
    (a, b) => b[1].timestamp - a[1].timestamp
  );
  const DISCARD_KEY = "DISCARD_OLD_REQUEST";
  while (listOfRequests.length >= MAX_CONCURRENT_REQUESTS) {
    const request = listOfRequests.pop()[1];
    request.controller.abort(DISCARD_KEY);
    log("🗑️", "Discarded request on", request.url);
  }
  try {
    setTextAndColor(tabId, "pending");
    const prediction = await getPrediction({
      screenshot,
      documentContent,
      controller,
    });
    if (prediction.tags) {
      const summaries = await userSummariesDb.getAll();
      const existingSummaries = summaries.filter((x) => x.url === tabURL);
      if (existingSummaries[0]) {
        // remove the existing summary for the same page
        // and then add the new one so the recency gets updated
        await userSummariesDb.delete(existingSummaries[0].timestamp);
      }
      log("✅", tabURL, "prediction", prediction);
      await userSummariesDb.put({
        timestamp: Date.now(),
        tags: prediction.tags,
        takeaways: prediction.takeaways,
        url: tabURL,
        title: tab.title,
      });
      setTextAndColor(tabId, "success");
    } else {
      log("❌", tabURL, "discard", prediction.status, prediction.reason);
      setTextAndColor(tabId, "fail");
    }
    cachedResults[key] = { url: tabURL, };
  } catch (e) {
    if (e.toString().includes(DISCARD_KEY)) {
      // User is switching between too many tabs too quickly and this one got booted
    } else {
      console.error(e);
    }
  }
  delete pendingRequests[key];
}