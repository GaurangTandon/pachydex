# Pachydex 🐘

**Your AI-Powered Memory Vault** - Like an elephant, Pachydex never forgets what you've read. If you read lots of articles or watch lots of videos on the internet, and want to semantically search from any past article or video, this Chrome extension is for you.

Why this extension is PERFECT for this job:

1. **Automatic** indexing of **relevant** content from **relevant** articles or videos on the web. This saves the user the time and effort of having to manually save pages they're already reading.
2. **100% on-device** processing ensures complete privacy for the user. As the extension runs automatically, it's essential it runs on-device only.
3. **AI-based classification** ignores irrelevant (non-article/non-video) pages from the web, such as search results page, directory pages, etc.
5. **AI-based summarizer** condenses each article or video into five bullet points. This ensures the key points of the article are strongly represented in the underlying embeddings, ensuring much more accurate search retrieval compared to other approaches.
4. **AI-based search** captures semantic user intent very well. For example: a search for "Indian dishes" will show an article about the "tandoori naan". The search is also robust even with 10K+ count of entries (when you read ten articles per day for several years).
4. **Smart content processing** converts the webpage text to Markdown format, allowing the AI to better understand the page structure. The conversion also removes irrelevant content from the page, such as invisible elements, captcha blockers, navbars, cookie popups, redirects, etc. as well as extracts the video transcript from a YouTube video page.
5. **AI-based tagging** allowing you to quickly view all previous articles matching specific tags.

AI models used:

- Chrome Built in AI model (Gemini v3Nano) for classification and summarization
- [EmbeddingGemma model](https://huggingface.co/google/embeddinggemma-300m) (FP32 model) for generating embeddings and semantic search.

The Chrome extension is written in vanilla JavaScript and uses IndexedDB in Chrome for efficient data storage and retrieval.

## Detailed extension flow

### Indexing the web (no user interaction)

1. On every page load, the extension automatically extracts the text content of the webpage, and filters out the parts that are (1) not visible to the user (hidden dialogs or captcha popups) or (2) not relevant to the AI (navbar, buttons, etc.). The document is then converted into Markdown.
2. The extension also takes a screenshot of the page.
3. The extension sends both the text and the screenshot to **Gemini Nano** (Chrome Built-in AI) to decide if the page hosts a clearly visible article or video and that it is not a confidential page.
   - Examples of webpages matching both the criteria: a Wikipedia article on geography, a blog post about Python, a single CNN news piece
   - Examples of webpages not matching the first criteria: the homepage of New York Times, Google Search results page, telephone directory pages, HN frontpage
   - Examples of webpages not matching the second criteria: personal bank account page or personal gmail inbox
4. If the page satisfies both criteria, and has not already been blocklisted by the user, the extension reuses **Gemini Nano** to generate tags and takeaways for the given page.
5. These are then stored in an IndexedDB.
6. There is a separate, routine job that runs every few minutes to generate vector embeddings for all the new entries in the IndexedDB.

### Searching the database (active user interaction)

1. On the options page, the user can initiate a search based on a query.
2. The extension uses EmbeddingGemma (the 8-bit quantised version of the 300M parameter model) to generate embeddings for the query, which are obtained in a Float32Array with 768 values.
3. The extension obtains cosine similarity score of the query embedding against all the pre-computed document embeddings (also using EmbeddingGemma), and returns sorted results based on the score (descending sort).

## Extension components

1. Content script: (a) converts document content to Markdown (so service worker can process it further), and (b) tracks time the user has spent on the page (so service worker knows when to start summarizing a page)
2. Sandbox document: runs the EmbeddingGemma model to generate embeddings.
3. Offscreen document: hosts the sandbox.
4. Service worker: each time a new tab in Chrome is focused or loaded, the service worker will use the AI model to classify the page, summarize it if needed, and store it in the IndexedDB.
5. Options page: shows the list of previously indexed pages and allows the user to search through them, or download/upload their list of summaries.
6. Popup: allows the user to enable/disable summarization on a specific page, as well as shows the summarization status on the current page.

## Notes on real world usage

1. Taking a reasonably high assumption of 20 article reads per day for 365 days of the year, we end up with ~7000 entries in one year, which takes up XX MB amount of space on disk. I tested search on this and it took ??ms to return relevant results.
1. The zip file for the extension is less than 300MB which is well within the limit for a [maximum Chrome extension size (2GB)](https://developer.chrome.com/docs/webstore/publish)

## Future goals

1. ??
