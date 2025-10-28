function mainProcess() {
  console.log('Pachydex: injected content script');
  function escapeMarkdown(text) {
    return text.replace(/([*_`])/g, "\\$1");
  }

  async function checkBlacklist() {
    const hostname = window.location.origin;
    const result = await chrome.storage.local.get("blacklist");
    const blacklist = result.blacklist || [];
    return blacklist.includes(hostname);
  }

  const ACTIVE_DELIMITER = "<<AI_AI>>";

  const MAX_CAPTCHA_RETRY_DURATION_MS = 30_000;
  const CATPCHA_RETRY_INTERVAL_MS = 1000;
  const MAX_CAPTCHA_RETRY_COUNT = MAX_CAPTCHA_RETRY_DURATION_MS / CATPCHA_RETRY_INTERVAL_MS;
  function promiseWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  /**
   * @returns {Promise<[string, string]>}
   */
  async function getYouTubeTranscript() {
    try {
      // Try to find transcript panel in YouTube's modern layout.
      // Transcript is loaded asynchronously and may not be available at mount
      // See if transcript exists in the page
      const hasTranscript = () => !!document.querySelector('ytd-transcript-segment-list-renderer #segments-container ytd-transcript-segment-renderer');
      const styleElm = document.createElement('style');

      if (!hasTranscript()) {
        styleElm.textContent = `
ytd-engagement-panel-section-list-renderer[target-id=engagement-panel-searchable-transcript] {
opacity: 0;
}
`;
        await new Promise((resolve) => {
          const interval = setInterval(() => {
            const button = document.querySelector('.ytd-video-description-transcript-section-renderer #primary-button ytd-button-renderer button');
            if (button) {
              clearInterval(interval);
              button.click();
              resolve();
            }
          }, 10);
        });
        console.log('clicked button');
        document.head.append(styleElm);
      }

      // Don't wait more than ten seconds for the transcript to load after we clicked on the button
      let interval;
      let success = false;
      await Promise.race([promiseWait(10_000), new Promise((resolve) => {
        interval = setInterval(() => {
          if (hasTranscript()) {
            success = true;
            clearInterval(interval);
            resolve();
          }
        }, 10);
      })]);
      // clear interval in case the promiseWait "won" the race
      clearInterval(interval);
      if (!success) {
        return ["", ""];
      }

      // can't use innertext for the transcript itemsbecause element is hidden
      const transcript = [...document.querySelectorAll('ytd-transcript-segment-list-renderer #segments-container yt-formatted-string')].map(x => x.textContent).join(' ');
      styleElm.remove();
      document.querySelector('ytd-engagement-panel-section-list-renderer[target-id=engagement-panel-searchable-transcript] #visibility-button').querySelector('button').click();
      console.log('done getting transcript', transcript);
      const title = document.getElementById('title').innerText;
      const description = document.getElementById('snippet').innerText;
      const result = `YouTube video: title "${title}" by channel "${document.getElementById('text').innerText}" with the following description:

"""
${description}
"""

and the following transcript:

"""
${transcript}
"""`;
      return [result, result];
    } catch (e) {
      console.log(e);
      return null;
    }
  }
  let blockedOnCaptcha = false;

  /**
   * Converts the given DOM element (typically document.body) to a Markdown string.
   * Handles links, bold text, headings, paragraphs, breaks, and code blocks.
   * Only run on YouTube video watch pages
   * 
   * @param {HTMLElement} element
   * @param {number} retryCount
   * @returns {Promise<[string, string]>}
   */
  async function convertElementToMarkdown(element, retryCount = 0) {
    if (isCaptchaElementPresent() && retryCount < MAX_CAPTCHA_RETRY_COUNT) {
      console.log('retrying because of captcha', retryCount, '/', MAX_CAPTCHA_RETRY_COUNT);
      blockedOnCaptcha = true;
      // retry for upto some time. if the captcha element is still present after that time, give up and convert it to markdown anyway
      return new Promise(resolve => {
        setTimeout(() => {
          // resolving with another promise just works, yay javascript!
          resolve(convertElementToMarkdown(element, retryCount + 1));
        }, CATPCHA_RETRY_INTERVAL_MS);
      });
    }
    blockedOnCaptcha = false;
    if (!element) {
      console.log('Missing element')
      return ["", ""];
    }
    if (location.hostname.includes('google.com') && location.pathname.startsWith('/url')) {
      // This is a redirect page used by google
      console.log('ignoring google redirect page');
      return ["", ""];
    }
    if (await checkBlacklist()) {
      console.log('Webpage is blacklisted')
      return ["", ""];
    }

    // Stack to process elements in depth-first order
    /** @type {({ insertDelimiter: true } | { insertFinalizer: true, finalizer: string, } | { element: Node, prefix: string, suffix: string, })[]} */
    const stack = [{ element, prefix: "", suffix: "" }];
    const results = [];

    while (stack.length > 0) {
      const result = stack.pop();
      if ("insertDelimiter" in result) {
        results.push(ACTIVE_DELIMITER);
        continue;
      }
      if ("insertFinalizer" in result) {
        results.push(result.finalizer);
        continue;
      }
      const { element: current, prefix, suffix } = result;

      // Handle text nodes
      if (current.nodeType === Node.TEXT_NODE) {
        // Do not trim otherwise trailing/leading spaces will be lost
        const text = escapeMarkdown(current.textContent);
        if (text) {
          results.push(prefix + text + suffix);
        }
        continue;
      }

      // Skip non-element nodes and svg nodes (which are Element but not HTMLElement)
      if (current.nodeType !== Node.ELEMENT_NODE || !('click' in current)) {
        continue;
      }
      if (!('innerText' in current) || !('tagName' in current)) {
        // Found this on MDN site once
        console.debug(current);
        console.error('Invalid node in markdown conversion');
        continue;
      }

      const tagName = current.tagName.toLowerCase();
      let newPrefix = prefix;
      let newSuffix = suffix;

      // Handle special elements
      switch (tagName) {
        case "a":
          // const href = current.getAttribute("href") || "";
          // links tend to take up too much space in the final markdown
          const linkText = current.innerText.trim();
          if (linkText) {
            results.push(`${prefix}[${linkText}]()${suffix}`);
          }
          continue;

        case "img":
          // const src = current.getAttribute("src") || "";
          // source of image tends to be very long and mysteriously worded which can confuse the LLM
          // like example:
          // https://media.cnn.com/api/v1/images/stellar/prod/gettyimages-2230342714.jpg?c=original&q=w_1041,c_fill
          const alt = current.getAttribute("alt") || "";
          if (!alt) {
            results.push(`${prefix}![${alt}]()${suffix}`);
          }
          continue;

        case "b":
        case "strong":
          newPrefix += "**";
          stack.push({ insertFinalizer: true, finalizer: "**" });
          break;

        case "i":
        case "em":
          newPrefix += "*";
          stack.push({ insertFinalizer: true, finalizer: "*" });
          break;

        case "code":
          // Check if this is inline code (not inside pre)
          if (
            current.parentElement &&
            current.parentElement.tagName.toLowerCase() !== "pre"
          ) {
            newPrefix += "`";
            stack.push({ insertFinalizer: true, finalizer: "`" });
          } else {
            // Inside pre tag, treat as normal text
          }
          break;

        case "pre":
          const codeElement = current.querySelector("code");
          const codeText = codeElement
            ? codeElement.textContent
            : current.textContent;
          results.push(`${prefix}\`\`\`\n${codeText}\n\`\`\`${suffix}`);
          continue;

        case "blockquote":
          // Process blockquote content and prefix each line with >
          const blockquoteText = current.innerText;
          const quotedLines = blockquoteText
            .split("\n")
            .map((line) => "> " + line)
            .join("\n");
          results.push(`${prefix}${quotedLines}${suffix}`);
          continue;

        case "h1":
          newPrefix += "# ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "h2":
          newPrefix += "## ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "h3":
          newPrefix += "### ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "h4":
          newPrefix += "#### ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "h5":
          newPrefix += "##### ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "h6":
          newPrefix += "###### ";
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;

        case "textarea":
          const textareaValue = current.value || current.textContent || "";
          results.push(`${prefix}\`\`\`\n${textareaValue}\n\`\`\`${suffix}`);
          continue;

        case "input":
          const inputType = current.getAttribute("type") || "text";
          const inputValue = current.value || "";
          const placeholder = current.getAttribute("placeholder") || "";

          if (
            inputType === "text" ||
            inputType === "email" ||
            inputType === "password"
          ) {
            const displayValue =
              inputValue || (placeholder ? `[${placeholder}]` : "[input]");
            results.push(`${prefix}\`${displayValue}\`${suffix}`);
          } else if (inputType === "checkbox" || inputType === "radio") {
            const checked = current.checked ? "[x]" : "[ ]";
            results.push(`${prefix}${checked}${suffix}`);
          } else {
            results.push(`${prefix}\`[${inputType} input]\`${suffix}`);
          }
          continue;

        case "br":
          results.push(prefix + "\n" + suffix);
          continue;

        case "p":
          stack.push({ insertFinalizer: true, finalizer: "\n\n" });
          break;

        case "div":
          stack.push({ insertFinalizer: true, finalizer: "\n" });
          break;
      }

      const isActive =
        current === document.activeElement && current.tagName !== "BODY";
      if (isActive) {
        results.push(ACTIVE_DELIMITER);
        stack.push({ insertDelimiter: true });
      }

      // Process children in reverse order (since we're using a stack)
      const children = Array.from(current.childNodes).reverse();

      if (children.length === 0) {
        // No children, just add the element with its formatting
        // Do not trim this text otherwise trailing whitespace will be cleared
        const text = escapeMarkdown(current.textContent);
        if (text || tagName === "br") {
          results.push(newPrefix + text + newSuffix);
        }
      } else {
        // Add children to stack for processing
        children.forEach((child) => {
          if (
            !("checkVisibility" in child) ||
            // Substack does this
            getComputedStyle(child).display === 'contents'
            || child.checkVisibility({
              checkyOpacity: true,
              checkVisibility: true,
            })
          ) {
            if (
              // StackOverflow shows a dialog which sets this
              child.getAttribute?.("aria-hidden") !== "true" &&
              child.tagName !== "INPUT" &&
              child.tagName !== "TEXTAREA" &&
              child.tagName !== "BUTTON" &&
              child.tagName !== "NAV" &&
              // Wikipedia uses SUP for citation which creates so MUCH NOISE!
              child.tagName !== "SUP" &&
              !child.isContentEditable
            ) {
              stack.push({
                element: child,
                prefix: newPrefix,
                suffix: newSuffix,
              });
            }
          }
        });
      }
    }

    // Combine results and clean up extra whitespace
    let markdown = results.join("");

    while (true) {
      let inputMarkdown = markdown;

      // Clean up multiple newlines
      inputMarkdown = inputMarkdown.replace(/\n{3,}/g, "\n\n");
      // Clean up multiple spaces
      inputMarkdown = inputMarkdown.replace(/[^\S\n]{3,}/g, "  ");
      // Clean up combinations
      inputMarkdown = inputMarkdown.replace(/\n\s+/g, "\n");

      if (markdown === inputMarkdown) {
        break;
      }
      markdown = inputMarkdown;
    }

    if ([...markdown.matchAll(new RegExp(ACTIVE_DELIMITER, "g"))].length > 2) {
      console.error("BUG IN ACTIVE LOGIC");
      console.log(markdown, document.activeElement);
      return;
    }
    // Trim around the active element if possible
    // At this limit, it consumers 8000 out of the available 9200 tokens
    const markdowns = /** @type {[string, string]}*/ ([10_000, 25_000].map(x => stripStringToLimit(markdown, x)));
    console.log(markdowns[1]);

    return markdowns;
  }

  /**
   * @param {string} markdown
   * @param {number} limit
   */
  function stripStringToLimit(markdown, limit) {
    const firstIndex = markdown.indexOf(ACTIVE_DELIMITER);
    let secondIndex = -1;
    if (firstIndex > -1) {
      secondIndex = markdown.indexOf(ACTIVE_DELIMITER, firstIndex + 1);
    }
    if (firstIndex > -1 && secondIndex > -1) {
      const minIndex = Math.max(0, Math.floor(firstIndex - limit / 2));
      let maxIndex = Math.min(
        markdown.length,
        Math.ceil(secondIndex + limit / 2)
      );
      if (maxIndex - minIndex > limit) {
        maxIndex = minIndex + limit;
      }
      markdown = markdown.substring(minIndex, maxIndex);
    } else {
      markdown = markdown.substring(0, limit);
    }
    markdown = markdown.replace(ACTIVE_DELIMITER, "");
    return markdown.trim();
  }

  let timeSpent = 0;
  // For whatever reason the StackOverflow approach doesn't work when the page loads
  // https://stackoverflow.com/a/63271409
  const soApproach = document.body.matches(':focus-within');
  const myApproach = document.hasFocus() && document.activeElement && document.activeElement.tagName !== 'IFRAME';
  let previousStartTime = soApproach || myApproach ? Date.now() : -1;
  console.debug('Loaded, start time:', previousStartTime, soApproach, myApproach);

  window.addEventListener("focus", () => {
    console.debug('Focused', previousStartTime, chrome.runtime.id);
    if (chrome.runtime.id) {
      // avoid running for orphaned content scripts
      chrome.runtime.sendMessage({ type: "isFocused" });
      previousStartTime = Date.now();
    }
  });
  window.addEventListener("blur", () => {
    console.debug('Blurred', previousStartTime);
    if (previousStartTime > 0) {
      timeSpent += Date.now() - previousStartTime;
      previousStartTime = -1;
    }
  });


  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getContent") {
      // Handle YouTube transcript extraction first if on YouTube video
      (async () => {
        let ytTranscript = null;
        if (location.hostname.includes('youtube.com') && location.pathname.startsWith('/watch')) {
          ytTranscript = await getYouTubeTranscript();
        }
        if (ytTranscript?.[0]) {
          sendResponse({ content: ytTranscript });
        } else {
          const markdownResult = await convertElementToMarkdown(document.body);
          sendResponse({ content: markdownResult });
        }
      })();
      return true;
    } else if (msg.type === "getTimeSpent") {
      let duration = timeSpent;
      if (previousStartTime > 0) {
        duration += Date.now() - previousStartTime;
      }
      console.debug('getTimeSpent', { timeSpent, previousStartTime, });
      sendResponse({ duration, });
    } else if (msg.type === "isAlive") {
      sendResponse({ isAlive: true });
    } else if (msg.type === 'isCaptcha') {
      sendResponse({ blockedOnCaptcha });
    }
  });

  /**
   * Currently supports turnstile and anubis and recpatcha
   * Only supposed to capture full page captcha block 
   * @returns {boolean}
   */
  function isCaptchaElementPresent() {
    const possibleSelectors = [
      '.cf-turnstile',
      'script[id=anubis_challenge]',
    ];

    if (document.querySelectorAll(possibleSelectors.join(',')).length > 0) {
      return true;
    }
    // set by recaptcha when trying to access archive.is pages
    if (document.getElementById('g-host') && document.querySelector('#g-recaptcha iframe')) {
      return true;
    }
    return false;
  }
}
mainProcess();