import { getBatchedEmbeddingsForDocuments, getBatchedEmbeddingsForSummaries, getFromSandbox } from "../utils/common.js";
import { userSummariesDb } from "../utils/indexeddb.js";

// Preload the model so it's ready to go if the user searches anything
getFromSandbox({ type: 'getModel', });

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
            <h2 class="summary-title">
              <a href="${targetUrl}" target="_blank" title="${pageTitle}">${pageTitle}</a>
            </h2>
            <div class="summary-header-right">
              <a href="${summary.url}" target="_blank" class="summary-url" title="${summary.url}">
                ${new URL(summary.url).hostname}
              </a>
              <span class="summary-date" title="${exactTimestamp}">${formatDate(summary.timestamp)}</span>
              <button class="delete-button" data-timestamp="${summary.timestamp}" title="Delete this summary">
                🗑️
              </button>
            </div>
          </div>
          <div class="tags-container">
            ${tagsHtml}
          </div>
          <div class="takeaways">
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

  // Add click event listener to hostname
  const hostnameLink = card.querySelector(".summary-url");
  hostnameLink.addEventListener("click", (e) => {
    e.preventDefault();
    const hostname = new URL(summary.url).hostname;
    filterByHostname(hostname);
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

function displaySummaries(summaries, searchQuery = null, filterTag = null, filterHostname = null) {
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
  } else if (filterHostname) {
    const header = document.createElement("div");
    header.className = "search-results-header";
    header.innerHTML = `
      <div class="search-results-title">Hostname: "${filterHostname}" (${summaries.length})</div>
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
  // document.querySelector('.search-results-header')?.scrollIntoView();
  container.scrollTo({ behavior: 'smooth', top: 0 });
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
 * Filter summaries by a specific hostname
 * @param {string} hostname - The hostname to filter by
 */
async function filterByHostname(hostname) {
  try {
    const allSummaries = await userSummariesDb.getAll();

    // Filter summaries that have the same hostname
    const filtered = allSummaries.filter((summary) => {
      try {
        return new URL(summary.url).hostname === hostname;
      } catch {
        return false;
      }
    });

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (filtered.length === 0) {
      const container = document.getElementById("summariesContainer");
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🌐</div>
          <div class="empty-state-text">No summaries found from "${hostname}"</div>
          <button class="clear-search" style="margin-top: 1rem;" id="clearFilterEmpty">Show All</button>
        </div>
      `;
      document.getElementById("clearFilterEmpty").addEventListener("click", () => {
        loadSummaries();
      });
    } else {
      displaySummaries(filtered, null, null, hostname);
    }
  } catch (error) {
    console.error("Error filtering by hostname:", error);
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
    // Clear search filter
    loadSummaries();
    return;
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

    // NOTE: can uncomment JSON download when binary format has issues
    // // Download JSON file first
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
    return;

    // // Small delay to ensure downloads don't conflict
    // await new Promise((resolve) => setTimeout(resolve, 100));
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

/**
 * Check the AI model availability status
 */
async function checkModelStatus() {
  const banner = document.getElementById('modelStatusBanner');
  const UNAVAILABLE_REASON = `Oh no! 😢 Pachy can't find the AI model on this device. Let's check if your system meets these requirements:
        <ul>
          <li><strong>Operating System:</strong> Windows 10+, macOS 13+ (Ventura and onwards), Linux, or ChromeOS (Chromebook Plus)</li>
          <li><strong>Storage:</strong> At least 22 GB of free space on the volume that contains your Chrome profile</li>
          <li><strong>GPU:</strong> Strictly more than 4 GB of VRAM, <strong>OR</strong>, <strong>CPU:</strong> 16 GB of RAM or more and 4 CPU cores or more</li>
          <li><strong>Network:</strong> Unlimited data or an unmetered connection</li>
          <li><strong>Note:</strong> Mobile devices (Android, iOS) and ChromeOS on non-Chromebook Plus devices are not yet supported</li>
        </ul>`;

  try {
    // Check if the Prompt API is available
    if (!('LanguageModel' in self)) {
      hideMainContent();
      showModelBanner(
        'unavailable',
        getSadAnimalSVG(),
        '💔 Pachy is Sad',
        UNAVAILABLE_REASON,
        false
      );
      return;
    }

    // Check model availability
    const availability = await LanguageModel.availability();

    if (availability === 'available') {
      // Model is ready, hide the banner and show content
      banner.style.display = 'none';
      showMainContent();
    } else if (availability === 'downloadable') {
      hideMainContent();
      showModelBanner(
        'downloadable',
        '⬇️',
        '🎉 Let\'s Get You Set Up!',
        'Hi there! 👋 I\'m Pachy, your elephant companion! Like elephants never forget, Pachydex remembers everything you\'ve read. To unlock the magic of AI-powered search, we need to download an AI model, only once!<br><br>Ready to build your memory vault? Click the button to get started!',
        true,
        '🚀 \u00a0 Download Model'
      );
    } else if (availability === 'unavailable') {
      hideMainContent();
      showModelBanner(
        'unavailable',
        getSadAnimalSVG(),
        '💔 Pachy is Sad',
        UNAVAILABLE_REASON,
        false
      );
    } else if (availability === 'downloading') {
      hideMainContent();
      showModelBanner(
        'downloading',
        getAnimalSVG(),
        '✨ Setting up Your Memory Vault!',
        'Pachy is fetching the AI model... This might take a few minutes. 🌟 Feel free to grab a cup of tea while we work our magic! ☕',
        false
      );
      // Show progress bar for active download
      document.getElementById('modelStatusProgress').style.display = 'flex';
    } else {
      hideMainContent();
      showModelBanner(
        'unavailable',
        getSadAnimalSVG(),
        '🤔 Hmm, Something\'s Odd',
        `Pachy encountered an unexpected status: "${availability}". This is unusual! Please try refreshing the page or check back later. 🐘`,
        false
      );
    }
  } catch (error) {
    console.error('Error checking AI model status:', error);
    hideMainContent();
    showModelBanner(
      'unavailable',
      getSadAnimalSVG(),
      '😔 Oops, Something Went Wrong',
      `Pachy couldn't check the AI model status. Error: ${error.message}<br><br>Try refreshing the page, and if the problem persists, Pachy might need some technical help! 🔧`,
      false
    );
  }
}

/**
 * Hide search and summaries sections
 */
function hideMainContent() {
  const searchSection = document.getElementById('searchSection');
  const summariesContainer = document.getElementById('summariesContainer');
  const headerStats = document.querySelector('.header-stats');
  const dataControls = document.querySelector('.data-controls');
  if (searchSection) searchSection.style.display = 'none';
  if (summariesContainer) summariesContainer.style.display = 'none';
  if (headerStats) headerStats.style.display = 'none';
  if (dataControls) dataControls.style.display = 'none';
}

/**
 * Show search and summaries sections
 */
function showMainContent() {
  const searchSection = document.getElementById('searchSection');
  const summariesContainer = document.getElementById('summariesContainer');
  const headerStats = document.querySelector('.header-stats');
  const dataControls = document.querySelector('.data-controls');
  if (searchSection) searchSection.style.display = 'block';
  if (summariesContainer) summariesContainer.style.display = 'block';
  if (headerStats) headerStats.style.display = 'flex';
  if (dataControls) dataControls.style.display = 'flex';
}

/**
 * Get a sad elephant SVG illustration
 */
function getSadAnimalSVG() {
  return `
    <svg class="animal-illustration" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <!-- Sad Elephant - Pachydex mascot -->
      
      <!-- Body -->
      <ellipse cx="100" cy="135" rx="55" ry="50" fill="#9e9e9e" />
      
      <!-- Head -->
      <circle cx="100" cy="80" r="42" fill="#b0b0b0" />
      
      <!-- Left Ear (drooping) -->
      <ellipse cx="58" cy="75" rx="25" ry="35" fill="#b0b0b0" transform="rotate(-35 58 75)" />
      <ellipse cx="58" cy="77" rx="18" ry="28" fill="#d4d4d4" transform="rotate(-35 58 77)" />
      
      <!-- Right Ear (drooping) -->
      <ellipse cx="142" cy="75" rx="25" ry="35" fill="#b0b0b0" transform="rotate(35 142 75)" />
      <ellipse cx="142" cy="77" rx="18" ry="28" fill="#d4d4d4" transform="rotate(35 142 77)" />
      
      <!-- Trunk (drooping lower) -->
      <path d="M 100 95 Q 102 115 98 130 Q 95 145 88 152 Q 85 155 84 158" 
            stroke="#a0a0a0" stroke-width="18" fill="none" stroke-linecap="round" />
      <path d="M 100 95 Q 102 115 98 130 Q 95 145 88 152 Q 85 155 84 158" 
            stroke="#b8b8b8" stroke-width="14" fill="none" stroke-linecap="round" />
      
      <!-- Trunk tip detail -->
      <ellipse cx="84" cy="158" rx="8" ry="6" fill="#a0a0a0" />
      
      <!-- Left Eye (sad) -->
      <ellipse cx="82" cy="74" rx="4" ry="5" fill="#2d2d2d" />
      <circle cx="84" cy="72" r="1.5" fill="#fff" />
      
      <!-- Right Eye (sad) -->
      <ellipse cx="118" cy="74" rx="4" ry="5" fill="#2d2d2d" />
      <circle cx="120" cy="72" r="1.5" fill="#fff" />
      
      <!-- Sad eyebrows -->
      <path d="M 75 68 Q 80 65 85 66" stroke="#2d2d2d" stroke-width="2" fill="none" stroke-linecap="round" />
      <path d="M 115 66 Q 120 65 125 68" stroke="#2d2d2d" stroke-width="2" fill="none" stroke-linecap="round" />
      
      <!-- Tusks -->
      <path d="M 88 88 Q 85 95 83 102" stroke="#f5f5f5" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M 112 88 Q 115 95 117 102" stroke="#f5f5f5" stroke-width="4" fill="none" stroke-linecap="round" />
      
      <!-- Sad frown -->
      <path d="M 88 90 Q 100 87 112 90" stroke="#2d2d2d" stroke-width="2" fill="none" stroke-linecap="round" />
      
      <!-- Left Front Leg -->
      <rect x="70" y="160" width="18" height="35" rx="9" fill="#9e9e9e" />
      <ellipse cx="79" cy="193" rx="10" ry="6" fill="#7a7a7a" />
      
      <!-- Right Front Leg -->
      <rect x="112" y="160" width="18" height="35" rx="9" fill="#9e9e9e" />
      <ellipse cx="121" cy="193" rx="10" ry="6" fill="#7a7a7a" />
      
      <!-- Tear drop on left cheek -->
      <ellipse cx="75" cy="85" rx="3" ry="5" fill="#87ceeb" opacity="0.8" />
      <circle cx="75" cy="82" r="2" fill="#b3e5fc" opacity="0.6" />
      
      <!-- Small broken heart (representing unavailable) -->
      <g opacity="0.7" transform="translate(155, 50)">
        <path d="M 0 8 L -6 2 Q -8 0 -8 -3 Q -8 -6 -5 -8 Q -2 -10 0 -7" fill="#e57373" />
        <path d="M 0 8 L 6 2 Q 8 0 8 -3 Q 8 -6 5 -8 Q 2 -10 0 -7" fill="#e57373" />
        <line x1="-2" y1="0" x2="2" y2="0" stroke="#fff" stroke-width="1.5" />
      </g>
    </svg>
  `;
}

/**
 * Get a cute elephant SVG illustration
 */
function getAnimalSVG() {
  return `
    <svg class="animal-illustration" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <!-- Happy Elephant - Pachydex mascot -->
      
      <!-- Body -->
      <ellipse cx="100" cy="135" rx="55" ry="50" fill="#9e9e9e" />
      
      <!-- Head -->
      <circle cx="100" cy="80" r="42" fill="#b0b0b0" />
      
      <!-- Left Ear -->
      <ellipse cx="60" cy="70" rx="25" ry="35" fill="#b0b0b0" transform="rotate(-25 60 70)" />
      <ellipse cx="60" cy="72" rx="18" ry="28" fill="#d4d4d4" transform="rotate(-25 60 72)" />
      
      <!-- Right Ear -->
      <ellipse cx="140" cy="70" rx="25" ry="35" fill="#b0b0b0" transform="rotate(25 140 70)" />
      <ellipse cx="140" cy="72" rx="18" ry="28" fill="#d4d4d4" transform="rotate(25 140 72)" />
      
      <!-- Trunk -->
      <path d="M 100 95 Q 105 110 100 125 Q 95 140 85 145 Q 80 147 78 150" 
            stroke="#a0a0a0" stroke-width="18" fill="none" stroke-linecap="round" />
      <path d="M 100 95 Q 105 110 100 125 Q 95 140 85 145 Q 80 147 78 150" 
            stroke="#b8b8b8" stroke-width="14" fill="none" stroke-linecap="round" />
      
      <!-- Trunk tip detail -->
      <ellipse cx="78" cy="150" rx="8" ry="6" fill="#a0a0a0" />
      
      <!-- Left Eye -->
      <circle cx="82" cy="72" r="5" fill="#2d2d2d" />
      <circle cx="84" cy="70" r="2" fill="#fff" />
      
      <!-- Right Eye -->
      <circle cx="118" cy="72" r="5" fill="#2d2d2d" />
      <circle cx="120" cy="70" r="2" fill="#fff" />
      
      <!-- Tusks -->
      <path d="M 88 88 Q 85 95 83 102" stroke="#f5f5f5" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M 112 88 Q 115 95 117 102" stroke="#f5f5f5" stroke-width="4" fill="none" stroke-linecap="round" />
      
      <!-- Smile -->
      <path d="M 88 85 Q 100 90 112 85" stroke="#2d2d2d" stroke-width="2" fill="none" stroke-linecap="round" />
      
      <!-- Left Front Leg -->
      <rect x="70" y="160" width="18" height="35" rx="9" fill="#9e9e9e" />
      <ellipse cx="79" cy="193" rx="10" ry="6" fill="#7a7a7a" />
      
      <!-- Right Front Leg -->
      <rect x="112" y="160" width="18" height="35" rx="9" fill="#9e9e9e" />
      <ellipse cx="121" cy="193" rx="10" ry="6" fill="#7a7a7a" />
      
      <!-- Memory sparkles (representing never forgetting) -->
      <g opacity="0.8">
        <path d="M 165 55 L 167 60 L 172 58 L 168 63 L 173 68 L 167 66 L 165 71 L 163 66 L 157 68 L 162 63 L 158 58 L 163 60 Z" fill="#667eea" />
        <path d="M 35 100 L 37 104 L 41 102 L 38 107 L 42 111 L 37 109 L 35 114 L 33 109 L 28 111 L 32 107 L 29 102 L 33 104 Z" fill="#667eea" />
        <path d="M 160 130 L 161 133 L 164 132 L 162 135 L 165 138 L 161 137 L 160 140 L 159 137 L 155 138 L 158 135 L 156 132 L 159 133 Z" fill="#667eea" />
        <path d="M 45 50 L 46 53 L 49 52 L 47 55 L 50 58 L 46 57 L 45 60 L 44 57 L 40 58 L 43 55 L 41 52 L 44 53 Z" fill="#764ba2" />
      </g>
    </svg>
  `;
}

/**
 * Show the model status banner with the given information
 */
function showModelBanner(status, icon, title, message, showButton, buttonText = '') {
  const banner = document.getElementById('modelStatusBanner');
  const iconEl = document.getElementById('modelStatusIcon');
  const titleEl = document.getElementById('modelStatusTitle');
  const messageEl = document.getElementById('modelStatusMessage');
  const actionButton = document.getElementById('modelActionButton');
  const progressContainer = document.getElementById('modelStatusProgress');

  // Show banner
  banner.style.display = 'block';

  // Update classes
  banner.className = 'model-status-banner';
  if (status === 'downloading') {
    banner.classList.add('downloading');
  } else if (status === 'downloadable') {
    banner.classList.add('downloadable');
  } else if (status === 'unavailable') {
    banner.classList.add('unavailable');
  }

  // Update content
  if (status === 'downloadable' || status === 'downloading') {
    iconEl.innerHTML = getAnimalSVG();
  } else if (status === 'unavailable') {
    iconEl.innerHTML = getSadAnimalSVG();
  } else {
    iconEl.innerHTML = icon;
  }
  titleEl.textContent = title;
  messageEl.innerHTML = message;
  if (status === 'downloadable' || status === 'downloading' || status === 'unavailable') {
    messageEl.classList.add('playful');
  }

  // Handle action button
  if (showButton) {
    actionButton.style.display = 'block';
    actionButton.textContent = buttonText;
    actionButton.disabled = false;
  } else {
    actionButton.style.display = 'none';
  }

  // Hide progress by default
  progressContainer.style.display = 'none';
}

/**
 * Download and initialize the AI model
 */
async function downloadModel() {
  const progressContainer = document.getElementById('modelStatusProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  try {
    // Show downloading status
    showModelBanner(
      'downloading',
      getAnimalSVG(),
      '✨ Building Your Memory Vault!',
      'Pachy is fetching the AI model... This might take a few minutes, but this will be worth the wait! 🌟 Feel free to grab a cup of tea while we work our magic! ☕',
      false
    );

    // Show progress bar
    progressContainer.style.display = 'flex';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';

    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const progress = Math.round(e.loaded * 100);
          progressFill.style.width = `${progress}%`;
          progressText.textContent = `${progress}%`;
          console.log(`Downloaded ${progress}%`);
        });
      },
    });

    // Model downloaded successfully - hide banner and show content
    const banner = document.getElementById('modelStatusBanner');
    banner.style.display = 'none';
    showMainContent();
    console.log('AI model downloaded successfully and is ready to use!');

    // Load summaries now that model is ready
    loadSummaries();

    // Clean up the session
    if (session && session.destroy) {
      session.destroy();
    }
  } catch (error) {
    console.error('Error downloading model:', error);
    showModelBanner(
      'unavailable',
      getSadAnimalSVG(),
      '😢 Download Didn\'t Work',
      `Pachy tried really hard, but the download failed: ${error.message}<br><br>Don't worry! You can try again later, or check your internet connection. Pachy will be here waiting! 💙`,
      false
    );
  }
}

// Add model action button event listener
document.getElementById('modelActionButton').addEventListener('click', downloadModel);

// Check model status on page load
checkModelStatus();

// For debugging
self.userSummariesDb = userSummariesDb;

// ------------------ Quiz mode implementation ------------------
document.getElementById('takeQuizButton').addEventListener('click', startQuiz);

// Fisher-Yates implementation
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pickRandomSummaries(summaries, count = 10) {
  const copy = summaries.slice();
  shuffleArray(copy);
  return copy.slice(0, Math.min(count, copy.length));
}

async function startQuiz() {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('takeQuizButton'));
  btn.disabled = true;
  const quizContainer = document.getElementById('quizContainer');
  const summariesContainer = document.getElementById('summariesContainer');
  try {
    // Load summaries and pick up to 10 random from the latest 100
    const allSummaries = await userSummariesDb.getAll();
    if (!allSummaries || allSummaries.length === 0) {
      alert('No summaries available to make a quiz.');
      return;
    }
    // Sort by timestamp descending (newest first)
    allSummaries.sort((a, b) => b.timestamp - a.timestamp);
    const latest100 = allSummaries.slice(0, 100);
    const selected = pickRandomSummaries(latest100, 2);

    // Ask AI to create questions
    quizContainer.style.display = 'block';
    summariesContainer.style.display = 'none';
    const quizContent = document.getElementById('quizContent');
    quizContent.innerHTML = `<div class="searching-indicator">🧠 Generating quiz questions...</div>`;

    let questions = null;
    try {
      questions = await generateQuestionsWithAI(selected);
    } catch (e) {
      console.error('AI question generation failed, falling back to local generator', e);
      // questions = generateQuestionsLocally(selected);
    }

    if (!questions || questions.length === 0) {
      quizContent.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">Could not generate quiz questions.</div></div>`;
      return;
    }

    runQuizUI(questions);
  } finally {
    btn.disabled = false;
  }
}

async function generateQuestionsWithAI(summaries) {
  if (!('LanguageModel' in self)) {
    throw new Error('LanguageModel API not available');
  }

  // Build the user prompt: enumerate summaries with title + takeaways
  let promptText = '';

  // promptText += '\n\nSummaries:\n';
  summaries.forEach((s, idx) => {
    const title = s.title || new URL(s.url).hostname;
    const takeaways = Array.isArray(s.takeaways) ? s.takeaways.join(' | ') : (s.takeaways || '');
    promptText += `\nSummary ${idx + 1}: title: ${title} \nTakeaways: ${takeaways}\n`;
  });
  console.log(promptText);

  const session = await LanguageModel.create({
    initialPrompts: [
      {
        role: 'system',
        content:
          'You are a helpful quiz-generator. ' + `You will be given up to 10 article summaries. For each summary, create one multiple-choice question (3 options). Output three options, two of which are plausible but incorrect. Keep questions concise (max 30 words) and options short (max 12 words). Return a JSON array of objects in the exact format: [{"question":"...","options":["...","...", "..."],"correctIndex": 0-2] with exactly one object per provided summary in the same order.`
      }
    ],
    expectedInputs: [{ type: 'text' }],
    expectedOutputs: [{ type: 'text' }],
  });

  const response = await session.prompt(
    [
      {
        role: 'user',
        content: promptText,
      },
    ],
    {
      responseConstraint: {
        type: 'array',
        minItems: summaries.length,
        maxItems: summaries.length,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', minLength: 5, maxLength: 200 },
            options: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: { type: 'string', minLength: 5, maxLength: 200 },
            },
            // correctAnswer: { type: 'string', minLength: 1, maxLength: 200 }
            correctIndex: { type: 'integer', minimum: 0, maximum: 2 },
            // source: { type: 'string' },
          },
          required: ['question', 'options', 'correctIndex'],
          additionalProperties: false,
        },
      },
    }
  );

  // session may be a LanguageModel; ensure to destroy if possible
  try {
    if (session && session.destroy) session.destroy();
  } catch (e) { }

  // response should be JSON text or already parsed
  let parsed = null;
  try {
    parsed = JSON.parse(response);
  } catch (e) {
    // Try to extract JSON from text
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw e;
    }
  }
  for (const item of parsed) {
    // item.options.push(item.correctAnswer);
    item.correctAnswer = item.options[item.correctIndex];
    shuffleArray(item.options)
    item.correctIndex = item.options.indexOf(item.correctAnswer);
  }

  return parsed;
}

// function generateQuestionsLocally(summaries) {
//   // Simple fallback: use the first takeaway as correct answer and pull distractors from other summaries
//   const questions = summaries.map((s, idx) => {
//     const question = `Which of the following is a key takeaway from "${(s.title || '').slice(0, 60)}"?`;
//     const correct = (s.takeaways && s.takeaways[0]) || 'Key point';
//     // pick two distractors from others
//     const otherTakeaways = summaries
//       .map((x) => (x.takeaways && x.takeaways[0]) || '')
//       .filter((t, i) => i !== idx && t && t !== correct);
//     shuffleArray(otherTakeaways);
//     const distract1 = otherTakeaways[0] || 'Some different point';
//     const distract2 = otherTakeaways[1] || 'Another different point';
//     const options = shuffleOptions([correct, distract1, distract2]);
//     const correctIndex = options.indexOf(correct);
//     return { question, options, correctIndex, source: s.timestamp };
//   });
//   return questions;
// }

// function shuffleOptions(arr) {
//   const copy = arr.slice();
//   shuffleArray(copy);
//   return copy;
// }

function runQuizUI(questions) {
  const quizContent = document.getElementById('quizContent');
  let current = 0;
  const answers = new Array(questions.length).fill(null);

  function render() {
    const q = questions[current];
    quizContent.innerHTML = `
      <div class="search-results-header">
        <div class="search-results-title">Quiz ${current + 1}/${questions.length}</div>
        <button class="clear-search" id="quitQuiz">Quit Quiz</button>
      </div>
      <div class="quiz-card">
        <div class="card-inner" id="cardInner">
          <div class="card-front">
            <div style="margin-bottom: 12px; font-weight:600">${escapeHtml(q.question)}</div>
            <form id="quizForm">
              ${q.options
        .map((opt, i) => `
                <label data-idx="${i}" class="quiz-option" style="display:block; margin-bottom:10px; padding:8px; border-radius:8px; display: flex; gap: 10px; align-items: center;">
                  <input type="radio" name="choice" value="${i}" /> ${escapeHtml(opt)}
                </label>
              `)
        .join('')}
              <div style="margin-top:12px; display:flex; gap:8px;">
                <button type="submit" class="data-button" id="submitAnswer">Submit</button>
                <button type="button" class="data-button" id="skipAnswer">Skip</button>
              </div>
            </form>
          </div>
          <div class="card-back" id="cardBack">
            <div style="font-weight:600">Answer</div>
            <div id="backContent" style="margin-top:8px"></div>
            <div style="margin-top:12px; display:flex; gap:8px;">
              <button class="data-button" id="nextButton">Next</button>
              <button class="data-button" id="quitAfter">Quit</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Quit button on header
    document.getElementById('quitQuiz').addEventListener('click', () => {
      if (confirm('Quit quiz and return to summaries?')) {
        endQuizEarly();
      }
    });

    // Skip will simply advance without flipping
    document.getElementById('skipAnswer').addEventListener('click', () => {
      answers[current] = null;
      nextQuestion();
    });

    const form = /** @type {HTMLFormElement} */ (document.getElementById('quizForm'));
    const cardInner = /** @type {HTMLElement} */ (document.getElementById('cardInner'));
    const cardBack = /** @type {HTMLElement} */ (document.getElementById('cardBack'));
    const backContent = /** @type {HTMLElement} */ (document.getElementById('backContent'));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const choiceVal = formData.get('choice');
      if (choiceVal === null) {
        alert('Please select an option or Skip.');
        return;
      }
      const choice = parseInt(String(choiceVal), 10);
      answers[current] = choice;

      // Disable inputs
      const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('input[name="choice"]'));
      inputs.forEach((inp) => (inp.disabled = true));

      // Highlight correct and wrong on front
      const correctIdx = q.correctIndex;
      const labels = form.querySelectorAll('label.quiz-option');
      labels.forEach((lbl) => {
        const idx = Number(lbl.getAttribute('data-idx'));
        lbl.classList.remove('option-correct', 'option-wrong');
        if (idx === correctIdx) lbl.classList.add('option-correct');
        if (idx === choice && idx !== correctIdx) lbl.classList.add('option-wrong');
      });

      // Fill back content with correct answer and user's answer
      const userAnswerText = q.options[choice] || '<em>Skipped</em>';
      const correctAnswerText = q.options[correctIdx];
      const isCorrect = choice === correctIdx;
      backContent.innerHTML = `
        <div>Correct answer: <strong>${escapeHtml(correctAnswerText)}</strong></div>
        <div style="margin-top:8px">Your answer: ${isCorrect ? '✅ ' : '❌ '}${escapeHtml(userAnswerText)}</div>
      `;

      // Flip card to reveal back
      setTimeout(() => {
        cardInner.classList.add('flipped');
      }, 50);

      // Next button click
      const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nextButton'));
      nextBtn.addEventListener('click', () => {
        // remove flip immediately then advance
        cardInner.classList.remove('flipped');
        nextQuestion();
      });

      // Quit after viewing
      document.getElementById('quitAfter').addEventListener('click', () => {
        endQuizEarly();
      });
    });
  }

  function nextQuestion() {
    current += 1;
    if (current >= questions.length) {
      showResults(questions, answers);
    } else {
      render();
    }
  }

  function endQuizEarly() {
    // Hide quiz and show summaries
    document.getElementById('quizContainer').style.display = 'none';
    document.getElementById('summariesContainer').style.display = 'block';
    document.getElementById('quizContent').innerHTML = '';
  }

  // Start
  render();
}

function showResults(questions, answers) {
  const quizContent = document.getElementById('quizContent');
  let score = 0;
  const rows = questions.map((q, i) => {
    const user = answers[i];
    const correct = q.correctIndex;
    const isCorrect = user === correct;
    if (isCorrect) score += 1;
    return `
      <div class="summary-card" style="margin-bottom:8px;">
        <div style="font-weight:600">Q${i + 1}: ${escapeHtml(q.question)}</div>
        <div style="margin-top:8px;">Correct answer: <strong>${escapeHtml(q.options[correct])}</strong></div>
        <div>Your answer: ${user === null || user === undefined ? '<em>Skipped</em>' : escapeHtml(q.options[user])} ${isCorrect ? '✅' : '❌'}</div>
      </div>
    `;
  });

  quizContent.innerHTML = `
    <div class="search-results-header">
      <div class="search-results-title">Quiz Complete — Score: ${score}/${questions.length}</div>
      <button class="clear-search" id="reviewBack">Back to Summaries</button>
    </div>
    <div style="margin-top:12px">${rows.join('')}</div>
  `;

  document.getElementById('reviewBack').addEventListener('click', () => {
    document.getElementById('quizContainer').style.display = 'none';
    document.getElementById('summariesContainer').style.display = 'block';
    document.getElementById('quizContent').innerHTML = '';
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------------------------------------------------------