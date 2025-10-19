// index.js (summaries page) and offscreen.js (offscreen document)

const sandboxIframe = /** @type {HTMLIFrameElement} */ (
  document.getElementById("sandbox")
);

/** @type {Object<string, (obj: any) => void} */
const waitingForResponse = {};

export async function getFromSandbox(msg) {
  const requestKey = Math.random().toString(16);
  const { promise, resolve } = Promise.withResolvers();
  waitingForResponse[requestKey] = resolve;
  sandboxIframe.contentWindow.postMessage(
    {
      ...msg,
      requestKey,
      modelPath: chrome.runtime.getURL("./model/"),
    },
    "*"
  );
  return promise;
}

window.addEventListener("message", (e) => {
  // console.log("main page", e.origin); this is null
  const det = e.data;
  if (det.type === "response") {
    const key = det.key;
    waitingForResponse[key](det.response);
    delete waitingForResponse[key];
  }
});

export async function getBatchedEmbeddingsForSummaries(summaries) {
  // Prepare documents for embedding (using takeaways as the text)
  const documents = summaries.map((summary) => {
    const doc = summary.takeaways.join(" ");
    const title = summary.title;
    return "title: " + title + " | text: " + doc;
  });
  return getBatchedEmbeddingsForDocuments(documents);
}

export async function getBatchedEmbeddingsForDocuments(documents) {
  return await getFromSandbox({
    type: "getBatchedEmbeddings",
    documents: documents,
  });
}