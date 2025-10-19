/**
 * Embedding processor that manages generating embeddings
 * for summaries that don't have them yet
 * Service worker context
 */

import { userSummariesDb } from "../utils/indexeddb.js";

const EMBEDDING_ALARM_NAME = "processEmbeddings";
const EMBEDDING_INTERVAL_MINUTES = 5; // Process every 5 minutes

/**
 * Initialize the embedding processor
 */
export async function initEmbeddingProcessor() {
  // Set up periodic alarm for processing embeddings
  chrome.alarms.create(EMBEDDING_ALARM_NAME, {
    periodInMinutes: EMBEDDING_INTERVAL_MINUTES,
    delayInMinutes: 0, // Start after 1 minute
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === EMBEDDING_ALARM_NAME) {
      processUnembeddedSummaries();
    }
  });

  console.log("Embedding processor initialized");
}

/** @type {Promise<boolean>} */
let offscreenDocumentPromise = null;

/**
 * Create offscreen document if it doesn't exist
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentPromise) {
    try {
      await offscreenDocumentPromise;
      const response = await chrome.runtime.sendMessage({ type: "ping" });
      if (response?.pong) {
        return true;
      }
    } catch (e) {
      // Document is not alive, need to recreate
      offscreenDocumentPromise = null;
    }
  }

  offscreenDocumentPromise = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("src/offscreen/offscreen.html"),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Generate embeddings for summaries using ML models",
  }).then(() => {
    console.log("Offscreen document created");
    // Wait a bit for the offscreen document to fully load
    return new Promise(resolve => setTimeout(() => resolve(true), 1000));
  });

  try {
    await offscreenDocumentPromise;
    return true;
  } catch (error) {
    if (!error.message.includes("Only a single offscreen")) {
      console.error("Error creating offscreen document:", error);
      return false;
    }
    return true;
  }
}

async function processUnembeddedSummaries() {
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    type: "generateEmbeddingsForAll",
  });
}

setTimeout(processUnembeddedSummaries, 2000);

/**
 * Close offscreen document
 */
export async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
    console.log("Offscreen document closed");
  } catch (error) {
    console.error("Error closing offscreen document:", error);
  }
}
