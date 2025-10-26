import { userSummariesDb } from "../utils/indexeddb.js";
import {
  getPrediction,
} from "./ai.js";

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
 * @param {{ tabId: number, windowId: number, }} tab
 * @returns {Promise<Blob>}
 */
async function getTabScreenshot({ windowId, tabId }) {
  if (
    lastScreenshot &&
    lastScreenshot.tabId === tabId &&
    Date.now() - lastScreenshot.time <= 200
  ) {
    // avoid hitting max capture per second limit
    return lastScreenshot.screenshot;
  }
  // just wait a little before capturing screenshot, otherwise we get the "Tabs cannot be edited right now" error when user is switching between tabs with their mouse
  // doesn't work if we use 50ms delay
  await new Promise(resolve => setTimeout(resolve, 200));
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

// default 0 in case service worker restarts
let activeFrameId = 0;
/** @type {Object<string, { controller: AbortController, timestamp: number, url: string, resultPromise: Promise<any>, result: { success: true} | { success: false, reason: string }, hasStoredInDB: boolean, hasWaitToStore: boolean, content: string, }>} */
let liveRequests = {};
// @ts-ignore for debugging
self.liveRequests = liveRequests;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'isFocused') {
    activeFrameId = sender.frameId;
  }
});

/**
 *
 * @param {number} tabId
 * @param {'success'|'pending'|'fail'|'waiting'} status
 * @param {string} title
 */
export function setTitleTextAndColor(tabId, status, title) {
  let text,
    /** @type {string|[number, number, number, number]} */
    color;
  if (status === "fail") {
    text = "x";
    color = "gray";
  } else if (status === "pending") {
    text = "⟳";
    color = "orange";
  } else if (status === 'waiting') {
    text = '⏳';
    color = [0, 0, 0, 0];
  } else if (status === 'success') {
    text = "✓";
    color = "green";
  } else {
    console.error('Unknown status: ' + status);
  }
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setTitle({ tabId, title: status === 'fail' ? 'Could not save this page because: ' + title : title });
}
/**
 * @param {Number} tabId
 */
export function resetBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' });
  chrome.action.setTitle({ tabId, title: '', });
}

/**
 * @param {string} url
 * @returns {string} Normalized URL string
 */
function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  let urlObject;
  try {
    urlObject = new URL(url);
  } catch (e) {
    return '';
  }
  // Remove hash because archive.ph page changes the hash
  // on each mouse selection which can cause multiple summaries
  // for basically the same page
  // Either way hash does not seem worth storing
  urlObject.hash = '';
  const hostname = urlObject.hostname;

  // Check if hostname doesn't start with "www." and is not an IP address or localhost
  if (!hostname.startsWith('www.') &&
    !hostname.match(/^\d+\.\d+\.\d+\.\d+$/) && // Not an IPv4
    hostname !== 'localhost' &&
    !hostname.startsWith('127.') &&
    hostname.split('.').length >= 2) { // Has at least domain.tld
    // Normalizes a URL by adding "www." to the hostname if not already present
    // This is necessary to handle some websites that redirect from one version to another
    urlObject.hostname = 'www.' + hostname;
  }

  return urlObject.href;
}

/**
 * @param {number} tabId 
 * @returns {Promise<boolean>}
 */
export async function isCSActive(tabId) {
  return await chrome.tabs
    .sendMessage(tabId, { type: "isAlive" }, { frameId: activeFrameId })
    .then((x) => !!x?.isAlive)
    .catch(() => false);
}
/**
 * @param {number} tabId 
 * @returns {Promise<number>}
 */
export async function getCSTimeSpent(tabId) {
  return await chrome.tabs
    .sendMessage(tabId, { type: "getTimeSpent" }, { frameId: activeFrameId })
    .then((x) => x.duration);
}

export const INACCESSIBLE_REASON = 'this webpage is inaccessible to Chrome extensions';
export const SAVING_REASON = 'Saving this page...';
const MAX_CONCURRENT_REQUESTS = 3;
/**
 * @param {string} url 
 * @returns 
 */
export function getNormalizedURL(url) {
  try {
    const tabNormalizedURL = normalizeUrl(url)
    return tabNormalizedURL;
  } catch (e) {
    return '';
  }
}
/**
 * @param {number} tabId
 */
function getKey(tabId) {
  // don't use frameId as it particularly does not seem relevant and that it can change as you're switching between tabs
  return tabId + ","; // + activeFrameId;
}

/**
 * @param {number} tabId 
 * @param {string} url 
 * @returns 
 */
export function getCacheWrittenToDB(tabId, url) {
  const key = getKey(tabId);
  if (getMatchingLiveRequest(tabId, url)) {
    if (liveRequests[key].hasStoredInDB) {
      return liveRequests[key].result;
    }
  }
  return null;
}

/**
 * This function by itself shouldn't have any side effects
 * 
 * @param {number} tabId 
 * @param {string} title
 * @param {string} url 
 * @returns 
 */
export function getAndStoreAvailableCachePromise(tabId, title, url) {
  const tabNormalizedURL = getNormalizedURL(url);
  const key = getKey(tabId);
  if (getMatchingLiveRequest(tabId, url)) {
    if (liveRequests[key].hasStoredInDB) {
      console.debug('Has in cache and has stored to DB');
      // if result is already stored to db, return it directly
      // although don't expect this to happen as we already checked it in
      // getCacheWrittenToDB before calling this function
      return liveRequests[key].result;
    }
    // otherwise store it if once it becomes available
    const promise = liveRequests[key].resultPromise;
    if (promise) {
      if (!liveRequests[key].hasWaitToStore) {
        console.debug('Has promise and now waiting to write to DB');
        // Only wait and write to DB once otherwise we would accidentally write multiple times
        liveRequests[key].hasWaitToStore = true;
        return liveRequests[key].resultPromise.then(async (prediction) => {
          if (prediction) {
            if (prediction.tags) {
              await writePredictionToDB(prediction, tabNormalizedURL, url, title);
            }
            liveRequests[key].hasStoredInDB = true;
            return liveRequests[key].result;
          }
          return null;
        });
      } else {
        console.debug('Has promise and skip write to DB (as already done before)');
        return liveRequests[key].resultPromise.then(() => {
          return liveRequests[key].result;
        });
      }
    }
  }
  return null;
}

/**
 * 
 * @param {*} prediction 
 * @param {string} tabNormalizedURL 
 * @param {string} tabOriginalURL 
 * @param {string} title 
 */
export async function writePredictionToDB(prediction, tabNormalizedURL, tabOriginalURL, title) {
  console.debug('Writing prediction to DB');
  const summaries = await userSummariesDb.getAll();
  const existingSummaries = summaries.filter((x) => normalizeUrl(x.url) === tabNormalizedURL);
  if (existingSummaries[0]) {
    // remove the existing summary for the same page
    // and then add the new one so the recency gets updated
    await userSummariesDb.delete(existingSummaries[0].timestamp);
  }
  await userSummariesDb.put({
    timestamp: Date.now(),
    tags: prediction.tags,
    takeaways: prediction.takeaways,
    url: tabOriginalURL, // store the real URL as it would contain the original www. (or not) and the original hash
    title,
  });
}

/**
 * 
 * @param {number} tabId 
 * @param {string} url 
 */
export function getMatchingLiveRequest(tabId, url) {
  const key = getKey(tabId);
  if (liveRequests[key]?.url === getNormalizedURL(url)) {
    return liveRequests[key];
  }
  return null;
}
const DELIM = '<<AI_AI>>';
/**
 * @param {string} str
 */
function getCleanedString(str) {
  return str.replaceAll(DELIM, '').replaceAll(/\s/g, '');
}

/**
 * Deduplicate requests on Google Maps
 * @param {number} tabId 
 * @param {string} tabOriginalURL
 * @param {number} frameId 
 */
async function getSecondaryMatchingLiveRequest(tabId, frameId, tabOriginalURL) {
  const key = getKey(tabId);
  const previousContent = liveRequests[key]?.content;
  if (!!liveRequests[key]?.url && !!previousContent) {
    const liveURLClone = new URL(liveRequests[key].url);
    const partsOne = liveURLClone.pathname.split('/');
    liveURLClone.pathname = '/';
    const currentURLClone = new URL(getNormalizedURL(tabOriginalURL));
    const partsTwo = currentURLClone.pathname.split('/');
    currentURLClone.pathname = '/';

    let diffCount = 0;
    for (let i = 0; i < Math.min(partsOne.length, partsTwo.length); i++) {
      if (partsOne[i] !== partsTwo[i]) {
        diffCount++;
      }
    }

    const apt1 = diffCount === 1 && partsOne.length === partsTwo.length;
    const apt2 = diffCount === 0 && Math.abs(partsOne.length - partsTwo.length) === 1;
    // if the entire URL except pathname is same
    if (liveURLClone.href === currentURLClone.href && (apt1 || apt2)) {
      // now check the content to ensure it's really the same
      const documentContent = await getTextContentFromPage(tabId, frameId);
      if (documentContent) {
        console.debug('Checking document content difference', getCleanedString(documentContent[0]), '\n----\n', getCleanedString(previousContent));
        if (getCleanedString(documentContent[0]) === getCleanedString(previousContent)) {
          // Same, update the live URL and call it a day
          liveRequests[key].url = getNormalizedURL(tabOriginalURL);
          return true;
        }
      }
    }
  }
  return null;
}

const DISCARD_KEY = "DISCARD_OLD_REQUEST";
/**
 * @param {number} tabId 
 * @param {number} windowId
 * @param {string} tabOriginalURL 
 */
export async function populateCache(tabId, windowId, tabOriginalURL) {
  const frameId = activeFrameId;
  if (getMatchingLiveRequest(tabId, tabOriginalURL)?.resultPromise) {
    // already working on the request
    console.debug('populateCache blocked as already have requestPromise');
    return;
  }
  if (await getSecondaryMatchingLiveRequest(tabId, frameId, tabOriginalURL)) {
    // already working on the request
    console.debug('populateCache blocked with secondary match as already have requestPromise');
    return;
  }
  const key = getKey(tabId);
  if (liveRequests[key]?.resultPromise) {
    // discard the previous running request on this same tab as we navigated away from that tab
    console.debug("🗑️", "Discarded request on due to tab navigation", {
      oldUrl: liveRequests[key].url,
      newUrl: tabOriginalURL,
      normalized: getNormalizedURL(tabOriginalURL)
    });
    liveRequests[key].controller.abort(DISCARD_KEY);
  }

  let tabNormalizedURL = getNormalizedURL(tabOriginalURL);
  console.debug("Runner starting new on", tabId, tabNormalizedURL);
  const controller = new AbortController();
  /** @type {(typeof liveRequests)[0]} */
  const obj = {
    controller,
    timestamp: Date.now(),
    url: tabNormalizedURL,
    hasStoredInDB: false,
    hasWaitToStore: false,
    result: null,
    resultPromise: null,
    content: '',
  };
  liveRequests[key] = obj;
  obj.resultPromise = gatherInfo({ tabId, frameId, windowId, url: tabOriginalURL, controller, }).then(async (prediction) => {
    console.debug('Got prediction', prediction);
    if (prediction) {
      if (!!prediction.tags) {
        obj.result = { success: true };
      } else {
        obj.result = { success: false, reason: prediction.reason, }
      }
    } else {
      // clear it so we can try again
      console.debug('clear promise 1', tabId, tabOriginalURL);
      obj.hasWaitToStore = false;
      obj.resultPromise = null;
    }
    return prediction;
  }).catch((e) => {
    console.error(e);
    // clear it so we can try again
    console.debug('clear promise 2', e, tabId, tabOriginalURL);
    obj.resultPromise = null;
    obj.hasWaitToStore = false;
    return null;
  });
  console.debug('populateCache request initiated');
}

/**
 * @param {number} tabId
 * @param {{ success: true } | { success: false, reason: string }} result
 */
export function setResultBadge(tabId, result) {
  setTitleTextAndColor(tabId, result.success ? 'success' : 'fail', result.success === true ? 'Web page saved successfully' : result.reason);
}

/**
 * @param {number} tabId 
 * @param {number} frameId 
 * @returns {Promise<[string, string]>}
 */
function getTextContentFromPage(tabId, frameId) {
  return chrome.tabs
    .sendMessage(tabId, { type: "getContent" }, { frameId })
    .then((x) => x.content)
    .catch((e) => {
      console.debug('Failed getContent', e);
      return ['', ''];
    });
}

/**
 * @param {number} tabId 
 * @param {number} windowId 
 * @param {string} tabOriginalURL
 * @param {number} frameId 
 */
async function getContentFromPage(tabId, windowId, frameId, tabOriginalURL) {
  let screenshot = null, documentContent = ['', ''];
  try {
    [screenshot, documentContent] = await Promise.all([
      getTabScreenshot({ tabId, windowId }).catch(e => {
        console.debug('Failed screenshot', e);
        return null;
      }),
      getTextContentFromPage(tabId, frameId)
    ]);
  } catch (e) {
    // this can fail if the page redirects after a few seconds like in the case of anubis
    console.debug('Failed unexpected', e);
  }
  console.debug("Got content from", tabOriginalURL, { screenshot, documentContent });
  return [screenshot, documentContent];
}

export async function gatherInfo({ tabId, windowId, frameId, url: tabOriginalURL, controller, }) {
  const [screenshot, documentContent] = await getContentFromPage(tabId, windowId, frameId, tabOriginalURL);
  if (!documentContent?.[0] || !screenshot) {
    setTitleTextAndColor(tabId, "fail", 'this webpage has no text or was unable to provide a screenshot');
    return null;
  }
  liveRequests[getKey(tabId)].content = documentContent[0];
  // Oldest request goes last, except ones that are already finished or have not re-run since last being discarded
  const listOfRequests = Object.entries(liveRequests).filter(x => !x[1].result && x[1].resultPromise).toSorted(
    (a, b) => b[1].timestamp - a[1].timestamp
  );
  while (listOfRequests.length >= MAX_CONCURRENT_REQUESTS) {
    const obj = listOfRequests.pop();
    const request = obj[1];
    request.controller.abort(DISCARD_KEY);
    console.debug("🗑️", "Discarded request on", request.url);
    // clear the request promise so it can be tried again
    liveRequests[obj[0]].hasWaitToStore = false;
    delete liveRequests[obj[0]]['resultPromise'];
  }
  try {
    const prediction = await getPrediction({
      url: tabOriginalURL,
      screenshot,
      documentContent,
      controller,
    });
    return prediction;
  } catch (e) {
    if (e.toString().includes(DISCARD_KEY)) {
      // User is switching between too many tabs too quickly and this one got booted
    } else {
      console.error(e);
    }
  }
}