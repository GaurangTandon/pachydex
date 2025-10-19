import { getBatchedEmbeddingsForDocuments, getBatchedEmbeddingsForSummaries } from "../utils/common.js";
import { userSummariesDb } from "../utils/indexeddb.js";

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
}

function createSummaryCard(summary) {
  const card = document.createElement("div");
  card.className = "summary-card";

  const tagsHtml = summary.tags
    .map((tag) => `<span class="tag" data-tag="${tag}">${tag.replace(/_/g, " ")}</span>`)
    .join("");

  const takeawaysHtml = summary.takeaways
    .map((takeaway) => `<div class="takeaway-item">${takeaway}</div>`)
    .join("");

  // Use link if available, otherwise fall back to url
  const targetUrl = summary.link || summary.url;
  const pageTitle = summary.title || new URL(summary.url).hostname;

  // Format exact timestamp for tooltip
  const exactTimestamp = new Date(summary.timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });

  card.innerHTML = `
          <div class="summary-header">
            <a href="${summary.url
    }" target="_blank" class="summary-url" title="${summary.url}">
              ${new URL(summary.url).hostname}
            </a>
            <div class="summary-header-right">
              <span class="summary-date" title="${exactTimestamp}">${formatDate(summary.timestamp)}</span>
              <button class="delete-button" data-timestamp="${summary.timestamp
    }" title="Delete this summary">
                🗑️
              </button>
            </div>
          </div>
          <h2 class="summary-title">
            <a href="${targetUrl}" target="_blank" title="${pageTitle}">${pageTitle}</a>
          </h2>
          <div class="tags-container">
            ${tagsHtml}
          </div>
          <div class="takeaways">
            <div class="takeaways-title">Key Takeaways:</div>
            ${takeawaysHtml}
          </div>
        `;

  // Add delete event listener
  const deleteButton = card.querySelector(".delete-button");
  deleteButton.addEventListener("click", (e) => {
    e.preventDefault();
    handleDelete(summary.timestamp, card);
  });

  // Add click event listeners to tags
  const tagElements = card.querySelectorAll(".tag");
  tagElements.forEach((tagElement) => {
    tagElement.addEventListener("click", (e) => {
      e.preventDefault();
      const tag = tagElement.getAttribute("data-tag");
      filterByTag(tag);
    });
  });

  return card;
}

async function handleDelete(timestamp, cardElement) {
  if (!confirm("Are you sure you want to delete this summary?")) {
    return;
  }

  try {
    await userSummariesDb.delete(timestamp);

    // Animate card removal
    cardElement.style.transition = "opacity 0.3s, transform 0.3s";
    cardElement.style.opacity = "0";
    cardElement.style.transform = "translateX(-20px)";

    setTimeout(() => {
      cardElement.remove();

      // Check if there are any remaining cards
      const container = document.getElementById("summariesContainer");
      const remainingCards = container.querySelectorAll(".summary-card");

      if (remainingCards.length === 0) {
        // If this was from a search, show no results message
        const searchInput = document.getElementById("searchInput");
        if (searchInput.value.trim()) {
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">🔍</div>
              <div class="empty-state-text">No matching summaries found</div>
              <button class="clear-search" style="margin-top: 1rem;" id="clearSearchEmpty">Show All</button>
            </div>
          `;
          document
            .getElementById("clearSearchEmpty")
            .addEventListener("click", () => {
              searchInput.value = "";
              loadSummaries();
            });
        } else {
          // Show empty state
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">📭</div>
              <div class="empty-state-text">No summaries yet. Browse some content to get started!</div>
            </div>
          `;
        }
      }

      // Update stats
      userSummariesDb.getAll().then((summaries) => {
        updateStats(summaries);
      });
    }, 300);
  } catch (error) {
    console.error("Error deleting summary:", error);
    alert("Failed to delete summary. Please try again.");
  }
}

async function loadSummaries() {
  try {
    const summaries = await userSummariesDb.getAll();
    const container = document.getElementById("summariesContainer");

    if (summaries.length === 0) {
      container.innerHTML = `
              <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No summaries yet. Browse some content to get started!</div>
              </div>
            `;
      return;
    }

    // Sort by timestamp descending (newest first)
    summaries.sort((a, b) => b.timestamp - a.timestamp);

    // Calculate stats
    updateStats(summaries);

    // Clear loading and add cards
    displaySummaries(summaries);
  } catch (error) {
    console.error("Error loading summaries:", error);
    document.getElementById("summariesContainer").innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">⚠️</div>
              <div class="empty-state-text">Error loading summaries. Please try refreshing the page.</div>
            </div>
          `;
  }
}

function updateStats(summaries) {
  const uniqueTags = new Set();
  let totalTakeaways = 0;

  summaries.forEach((summary) => {
    summary.tags.forEach((tag) => uniqueTags.add(tag));
    totalTakeaways += summary.takeaways.length;
  });

  document.getElementById("totalCount").textContent = summaries.length;
  document.getElementById("tagCount").textContent = uniqueTags.size;
  document.getElementById("takeawayCount").textContent = totalTakeaways;
}

function displaySummaries(summaries, searchQuery = null, filterTag = null) {
  const container = document.getElementById("summariesContainer");
  container.innerHTML = "";

  if (searchQuery) {
    const header = document.createElement("div");
    header.className = "search-results-header";
    header.innerHTML = `
      <div class="search-results-title">Search Results: "${searchQuery}" (${summaries.length})</div>
      <button class="clear-search" id="clearSearch">Clear Search</button>
    `;
    container.appendChild(header);

    document.getElementById("clearSearch").addEventListener("click", () => {
      document.getElementById("searchInput").value = "";
      loadSummaries();
    });
  } else if (filterTag) {
    const header = document.createElement("div");
    header.className = "search-results-header";
    header.innerHTML = `
      <div class="search-results-title">Tag: "${filterTag.replace(/_/g, " ")}" (${summaries.length})</div>
      <button class="clear-search" id="clearFilter">Show All</button>
    `;
    container.appendChild(header);

    document.getElementById("clearFilter").addEventListener("click", () => {
      loadSummaries();
    });
  }

  summaries.forEach((summary) => {
    container.appendChild(createSummaryCard(summary));
  });
}

/**
 * Filter summaries by a specific tag
 * @param {string} tag - The tag to filter by
 */
async function filterByTag(tag) {
  try {
    const allSummaries = await userSummariesDb.getAll();

    // Filter summaries that contain the tag
    const filtered = allSummaries.filter((summary) =>
      summary.tags.includes(tag)
    );

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (filtered.length === 0) {
      const container = document.getElementById("summariesContainer");
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏷️</div>
          <div class="empty-state-text">No summaries found with tag "${tag.replace(/_/g, " ")}"</div>
          <button class="clear-search" style="margin-top: 1rem;" id="clearFilterEmpty">Show All</button>
        </div>
      `;
      document.getElementById("clearFilterEmpty").addEventListener("click", () => {
        loadSummaries();
      });
    } else {
      displaySummaries(filtered, null, tag);
    }
  } catch (error) {
    console.error("Error filtering by tag:", error);
    alert("Failed to filter summaries. Please try again.");
  }
}

/**
 * Calculate cosine similarity between two vectors
 * Assumes vectors are already normalized
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

const QUERY_PREFIX = "task: search result | query: ";

/**
 * Search summaries using embeddings
 * @param {string} searchQuery - The search query
 * @param {Array} summaries - Array of summaries with embeddings
 * @returns {Promise<Array>} - Ranked search results
 */
async function searchWithEmbeddings(searchQuery, summaries) {
  // Generate embedding for the search query
  const queryEmbeddingResult = await getBatchedEmbeddingsForDocuments([QUERY_PREFIX + searchQuery]);

  const queryEmbedding = queryEmbeddingResult.data;

  // Filter summaries that have embeddings
  const summariesWithEmbeddings = summaries.filter((s) => s.embeddings);

  // Calculate similarities
  const results = summariesWithEmbeddings.map((summary) => {
    const similarity = cosineSimilarity(queryEmbedding, summary.embeddings);
    return {
      summary,
      score: similarity,
    };
  });

  // Sort by similarity score (descending)
  results.sort((a, b) => b.score - a.score);

  // Filter results with minimum relevance score of 0.4
  const filteredResults = results.filter((r) => r.score >= 0.4);

  console.log(
    "Search results with scores:",
    filteredResults.map((r) => ({
      title: r.summary.title,
      score: r.score,
      takeaways: r.summary.takeaways[0],
    }))
  );

  // Return all results with score >= 0.4
  return filteredResults;
}

async function handleSearch() {
  /** @type {HTMLInputElement} */
  const searchInput = document.getElementById("searchInput");
  /** @type {HTMLButtonElement} */
  const searchButton = document.getElementById("searchButton");
  let searchQuery = searchInput.value.trim();

  if (!searchQuery) {
    // TODO: for testing
    searchQuery =
      "What are some examples of online companies deceiving their customers and changing their policy terms?";
    // searchQuery = 'Any Indian cooking recipes?';
    // searchQuery = "Examples of politically motivated company takeovers";
    // searchQuery = "dark patterns enforced by big corporations";
  }

  try {
    searchButton.disabled = true;

    const container = document.getElementById("summariesContainer");

    // Get all summaries
    const allSummaries = await userSummariesDb.getAll();

    const EXPECTED_LENGTH = 768;
    // Find summaries without embeddings
    const summariesWithoutEmbeddings = allSummaries.filter(
      (summary) => !summary.embeddings || summary.embeddings.length !== EXPECTED_LENGTH
    );

    // temporarily disabled
    if (summariesWithoutEmbeddings.length > 0) {
      console.log(
        `Generating embeddings for ${summariesWithoutEmbeddings.length} summaries...`
      );

      searchButton.textContent = "Generating embeddings...";
      // Process in batches of 32
      const BATCH_SIZE = 32;
      const totalBatches = Math.ceil(
        summariesWithoutEmbeddings.length / BATCH_SIZE
      );

      for (let i = 0; i < summariesWithoutEmbeddings.length; i += BATCH_SIZE) {
        const batch = summariesWithoutEmbeddings.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        console.log(`Processing batch ${batchNumber}/${totalBatches}...`);
        container.innerHTML = `<div class="searching-indicator">🔄 Generating embeddings... (batch ${batchNumber}/${totalBatches})</div>`;

        // Get embeddings from sandbox
        const embeddings = await getBatchedEmbeddingsForSummaries(batch);

        // Update each summary with its embedding
        for (let j = 0; j < batch.length; j++) {
          const summary = batch[j];
          const embeddingSize = embeddings.dims[1]; // Size of each embedding vector
          const startIdx = j * embeddingSize;
          const endIdx = startIdx + embeddingSize;
          const embeddingArray = embeddings.data.slice(startIdx, endIdx);

          // Update the summary with the embedding
          summary.embeddings = embeddingArray;
          if (embeddingArray.length !== EXPECTED_LENGTH) {
            console.log(EXPECTED_LENGTH);
            console.log(embeddingArray);
            throw new Error('Unexpected embedding size');
          }
          await userSummariesDb.put(summary);
        }

        console.log(`Batch ${batchNumber}/${totalBatches} completed`);
      }

      console.log("All embeddings generated and stored");
    }

    searchButton.textContent = "Searching...";
    container.innerHTML =
      '<div class="searching-indicator">🔍 Searching your summaries...</div>';

    // Use embedding-based search
    const results = await searchWithEmbeddings(searchQuery, allSummaries);

    if (results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-text">No matching summaries found for "${searchQuery}"</div>
          <button class="clear-search" style="margin-top: 1rem;" id="clearSearchEmpty">Show All</button>
        </div>
      `;
      document
        .getElementById("clearSearchEmpty")
        .addEventListener("click", () => {
          searchInput.value = "";
          loadSummaries();
        });
    } else {
      const summaries = results.map((r) => r.summary);
      displaySummaries(summaries, searchQuery, null);
    }
  } catch (error) {
    console.error("Search error:", error);
    const container = document.getElementById("summariesContainer");
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">Error searching summaries. Please try again.</div>
      </div>
    `;
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "🔍 Search";
  }
}

/**
 * Encode summaries to efficient binary format
 * Format: [version][count][summary1][summary2]...
 * Each summary: [timestamp][url_len][url][title_len][title][link_len][link]
 *               [tags_count][tag1_len][tag1]...[takeaways_count][takeaway1_len][takeaway1]...
 *               [has_embeddings][embeddings_data]
 */
function encodeSummariesToBinary(summaries) {
  const encoder = new TextEncoder();
  const buffers = [];

  // Version byte (for future compatibility)
  buffers.push(new Uint8Array([1]));

  // Number of summaries (4 bytes)
  const countBuffer = new ArrayBuffer(4);
  new DataView(countBuffer).setUint32(0, summaries.length, true);
  buffers.push(new Uint8Array(countBuffer));

  for (const summary of summaries) {
    // Timestamp (8 bytes, double)
    const timestampBuffer = new ArrayBuffer(8);
    new DataView(timestampBuffer).setFloat64(0, summary.timestamp, true);
    buffers.push(new Uint8Array(timestampBuffer));

    // URL
    const urlBytes = encoder.encode(summary.url);
    const urlLenBuffer = new ArrayBuffer(4);
    new DataView(urlLenBuffer).setUint32(0, urlBytes.length, true);
    buffers.push(new Uint8Array(urlLenBuffer));
    buffers.push(urlBytes);

    // Title (optional)
    const titleBytes = encoder.encode(summary.title || "");
    const titleLenBuffer = new ArrayBuffer(4);
    new DataView(titleLenBuffer).setUint32(0, titleBytes.length, true);
    buffers.push(new Uint8Array(titleLenBuffer));
    buffers.push(titleBytes);

    // Link (optional)
    const linkBytes = encoder.encode(summary.link || "");
    const linkLenBuffer = new ArrayBuffer(4);
    new DataView(linkLenBuffer).setUint32(0, linkBytes.length, true);
    buffers.push(new Uint8Array(linkLenBuffer));
    buffers.push(linkBytes);

    // Tags
    const tagsCountBuffer = new ArrayBuffer(2);
    new DataView(tagsCountBuffer).setUint16(0, summary.tags.length, true);
    buffers.push(new Uint8Array(tagsCountBuffer));
    for (const tag of summary.tags) {
      const tagBytes = encoder.encode(tag);
      const tagLenBuffer = new ArrayBuffer(2);
      new DataView(tagLenBuffer).setUint16(0, tagBytes.length, true);
      buffers.push(new Uint8Array(tagLenBuffer));
      buffers.push(tagBytes);
    }

    // Takeaways
    const takeawaysCountBuffer = new ArrayBuffer(2);
    new DataView(takeawaysCountBuffer).setUint16(
      0,
      summary.takeaways.length,
      true
    );
    buffers.push(new Uint8Array(takeawaysCountBuffer));
    for (const takeaway of summary.takeaways) {
      const takeawayBytes = encoder.encode(takeaway);
      const takeawayLenBuffer = new ArrayBuffer(2);
      new DataView(takeawayLenBuffer).setUint16(0, takeawayBytes.length, true);
      buffers.push(new Uint8Array(takeawayLenBuffer));
      buffers.push(takeawayBytes);
    }

    // Embeddings (if present)
    if (summary.embeddings && summary.embeddings.length > 0) {
      buffers.push(new Uint8Array([1])); // Has embeddings
      const embLenBuffer = new ArrayBuffer(4);
      new DataView(embLenBuffer).setUint32(0, summary.embeddings.length, true);
      buffers.push(new Uint8Array(embLenBuffer));
      // Store as Float32Array (4 bytes per float)
      buffers.push(new Uint8Array(summary.embeddings.buffer));
    } else {
      buffers.push(new Uint8Array([0])); // No embeddings
    }
  }

  // Calculate total size
  const totalSize = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }

  return result;
}

/**
 * Decode binary format back to summaries
 */
function decodeBinaryToSummaries(buffer) {
  const decoder = new TextDecoder();
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  // Version
  const version = data[offset++];
  if (version !== 1) {
    throw new Error("Unsupported format version");
  }

  // Count
  const count = view.getUint32(offset, true);
  offset += 4;

  const summaries = [];

  for (let i = 0; i < count; i++) {
    const summary = {};

    // Timestamp
    summary.timestamp = view.getFloat64(offset, true);
    offset += 8;

    // URL
    const urlLen = view.getUint32(offset, true);
    offset += 4;
    summary.url = decoder.decode(data.slice(offset, offset + urlLen));
    offset += urlLen;

    // Title
    const titleLen = view.getUint32(offset, true);
    offset += 4;
    summary.title = decoder.decode(data.slice(offset, offset + titleLen));
    offset += titleLen;

    // Link
    const linkLen = view.getUint32(offset, true);
    offset += 4;
    const linkStr = decoder.decode(data.slice(offset, offset + linkLen));
    if (linkStr) summary.link = linkStr;
    offset += linkLen;

    // Tags
    const tagsCount = view.getUint16(offset, true);
    offset += 2;
    summary.tags = [];
    for (let j = 0; j < tagsCount; j++) {
      const tagLen = view.getUint16(offset, true);
      offset += 2;
      const tag = decoder.decode(data.slice(offset, offset + tagLen));
      summary.tags.push(tag);
      offset += tagLen;
    }

    // Takeaways
    const takeawaysCount = view.getUint16(offset, true);
    offset += 2;
    summary.takeaways = [];
    for (let j = 0; j < takeawaysCount; j++) {
      const takeawayLen = view.getUint16(offset, true);
      offset += 2;
      const takeaway = decoder.decode(data.slice(offset, offset + takeawayLen));
      summary.takeaways.push(takeaway);
      offset += takeawayLen;
    }

    // Embeddings
    const hasEmbeddings = data[offset++];
    if (hasEmbeddings === 1) {
      const embLen = view.getUint32(offset, true);
      offset += 4;
      const embData = buffer.slice(offset, offset + embLen * 4);
      summary.embeddings = new Float32Array(embData);
      offset += embLen * 4;
    }

    summaries.push(summary);
  }

  return summaries;
}

async function handleDownload() {
  try {
    const summaries = await userSummariesDb.getAll();
    let dateStr = new Date().toISOString();

    // Download JSON file first
    const jsonStr = JSON.stringify(summaries, null, 2);
    const jsonBlob = new Blob([jsonStr], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement("a");
    jsonLink.href = jsonUrl;
    jsonLink.download = `summaries-backup-${dateStr}.json`;
    document.body.appendChild(jsonLink);
    jsonLink.click();
    document.body.removeChild(jsonLink);
    URL.revokeObjectURL(jsonUrl);

    // Small delay to ensure downloads don't conflict
    await new Promise((resolve) => setTimeout(resolve, 100));
    dateStr = new Date().toISOString();

    // Then download binary file
    const binaryData = encodeSummariesToBinary(summaries);
    const binaryBlob = new Blob([binaryData], {
      type: "application/octet-stream",
    });
    const binaryUrl = URL.createObjectURL(binaryBlob);
    const binaryLink = document.createElement("a");
    binaryLink.href = binaryUrl;
    binaryLink.download = `summaries-backup-${dateStr}.bin`;
    document.body.appendChild(binaryLink);
    binaryLink.click();
    document.body.removeChild(binaryLink);
    URL.revokeObjectURL(binaryUrl);

    // Calculate and display size savings
    const jsonSize = jsonBlob.size;
    const binarySize = binaryData.length;
    const savings = ((1 - binarySize / jsonSize) * 100).toFixed(1);
    console.log(`Downloaded ${summaries.length} summaries in both formats`);
    console.log(`JSON size: ${(jsonSize / 1024).toFixed(2)} KB`);
    console.log(`Binary size: ${(binarySize / 1024).toFixed(2)} KB`);
    console.log(`Space saved by binary: ${savings}%`);
  } catch (error) {
    console.error("Error downloading data:", error);
    alert("Failed to download data. Please try again.");
  }
}

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    let summaries;

    // Check if it's binary format (.bin) or legacy JSON format
    if (file.name.endsWith(".bin")) {
      const arrayBuffer = await file.arrayBuffer();
      summaries = decodeBinaryToSummaries(arrayBuffer);
    } else {
      // Legacy JSON format support
      const text = await file.text();
      summaries = JSON.parse(text);
    }

    if (!Array.isArray(summaries)) {
      throw new Error("Invalid data format: expected an array");
    }

    // Validate that each item has required fields
    for (const summary of summaries) {
      if (
        !summary.timestamp ||
        !summary.url ||
        !summary.tags ||
        !summary.takeaways
      ) {
        throw new Error("Invalid data format: missing required fields");
      }
    }

    const confirmMessage = `This will add ${summaries.length} summaries to your database. Continue?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    // Add all summaries to the database
    await userSummariesDb.putMany(summaries);

    // Reload the page to show updated data
    loadSummaries();

    alert(`Successfully imported ${summaries.length} summaries!`);
  } catch (error) {
    console.error("Error uploading data:", error);
    alert(`Failed to upload data: ${error.message}`);
  } finally {
    // Reset the file input
    event.target.value = "";
  }
}

// Load summaries when page loads
loadSummaries();

// Add search event listeners
document.getElementById("searchButton").addEventListener("click", handleSearch);
document.getElementById("searchInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    handleSearch();
  }
});

// Add download/upload event listeners
document
  .getElementById("downloadButton")
  .addEventListener("click", handleDownload);
document.getElementById("uploadButton").addEventListener("click", () => {
  document.getElementById("uploadInput").click();
});
document.getElementById("uploadInput").addEventListener("change", handleUpload);

// For debugging
self.userSummariesDb = userSummariesDb;