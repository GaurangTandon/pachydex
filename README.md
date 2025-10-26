# Pachydex 🐘

Your AI-Powered Memory Vault - Pachydex never forgets what you've read. Semantically search through every article and video you've encountered on the web.

Pachydex supports a diverse set of use cases across different needs:

1. **Students** writing research papers can quickly find articles that support their claims
1. **Professionals** learning new topics can revisit tutorials watched months ago
1. **Engineers** making architectural decisions can recall technical comparisons researched earlier
1. **Writers** researching topics can pull up all relevant articles for inspiration
1. **Personal** users can find product reviews read weeks ago or remember that Indian dish from last week

...and much more.

## Key Features

### 🤖 Intelligent & Automatic

- **Auto-indexing** - Captures relevant content as you browse, no manual user interaction needed
- **Smart classification** - AI filters out irrelevant pages (search results, directory pages, forum homepages, etc.) so your index is not cluttered
- **Semantic search** - Understands intent: searching "Indian dishes" finds that "tandoori naan" article
- **AI summarization** - Condenses each page into 5 bullet points (this ensures the key points of the article are strongly represented in the underlying embeddings, ensuring more accurate search retrieval)
- **Smart tagging** - Automatically assigns three to five tags to each article for quick filtering
- **Active recall quizzes** - Test your knowledge on previously read articles

### 🔒 Private & Secure

- **100% on-device processing** - Your data never leaves your computer
- **Fully offline** - Works without internet connectivity
- **Minimal dependencies** - Only uses `@huggingface/transformers` in a separate sandboxed process without internet access

### ⚡ Powerful & Efficient

- **Scales effortlessly** - Handles thousands of entries with fast search
- **Smart content processing** - Converts pages to Markdown so AI can understand the page structure better, while also detecting and removing clutter (navbars, popups, captchas, redirects), as well as focusing the content around your current selection
- **YouTube support** - Extracts and indexes video transcripts
- **Efficient storage** - Uses IndexedDB for optimal performance

## Technology Stack

### AI Models

- [Chrome Built in AI (Gemini v3Nano)](https://developer.chrome.com/docs/ai/prompt-api) - For the following tasks:
  - classification of a given web page into article vs non-article
  - summarization of given web page into few key points
  - tagging a given webpage
  - generating a quiz based on articles the user has read previously
- [EmbeddingGemma model](https://huggingface.co/google/embeddinggemma-300m) (8-bit quantized integer model) - For generating embeddings for semantic search

### Platform

- Manifest V3 Chrome Extension
- Vanilla JavaScript
- IndexedDB

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

1. Stats section to show how much you've read every week or month
2. Better AI models to ensure accurate classification and summarization
