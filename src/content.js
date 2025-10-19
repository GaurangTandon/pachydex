function mainProcess() {
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

  const MAX_CAPTCHA_RETRY_DURATION_MS = 10_000;
  const CATPCHA_RETRY_INTERVAL_MS = 1000;
  const MAX_CAPTCHA_RETRY_COUNT = MAX_CAPTCHA_RETRY_DURATION_MS / CATPCHA_RETRY_INTERVAL_MS;
  /**
   * Converts the given DOM element (typically document.body) to a Markdown string.
   * Handles links, bold text, headings, paragraphs, breaks, and code blocks.
   *
   * @param {HTMLElement} element
   * @param {number} retryCount
   * @returns {Promise<string[]>}
   */
  async function convertElementToMarkdown(element, retryCount = 0) {
    if (isCaptchaElementPresent() && retryCount < MAX_CAPTCHA_RETRY_COUNT) {
      console.log('retrying because of captcha', retryCount, '/', MAX_CAPTCHA_RETRY_COUNT);
      // retry for upto some time. if the captcha element is still present after that time, give up and convert it to markdown anyway
      return new Promise(resolve => {
        setTimeout(() => {
          // resolving with another promise just works, yay javascript!
          resolve(convertElementToMarkdown(element, retryCount + 1));
        }, CATPCHA_RETRY_INTERVAL_MS);
      });
    }
    if (!element) return ["", ""];
    if (location.hostname.includes('google.com') && location.pathname.startsWith('/url')) {
      // This is a redirect page used by google
      return ["", ""];
    }
    if (await checkBlacklist()) {
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

      // Skip non-element nodes
      if (current.nodeType !== Node.ELEMENT_NODE) {
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
          results.push(`${prefix}![${alt}]()${suffix}`);
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
    const markdowns = [];
    // Trim around the active element if possible
    // At this limit, it consumers 8000 out of the available 9200 tokens
    for (const limit of [10_000, 25_000]) {
      markdowns.push(stripStringToLimit(markdown, limit));
    }
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

  window.addEventListener("focus", () => {
    if (chrome.runtime.id) {
      // avoid running for orphaned content scripts
      chrome.runtime.sendMessage({ type: "isFocused" });
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getContent") {
      convertElementToMarkdown(document.body).then((result) => {
        sendResponse({ content: result });
      });
      return true;
    } else if (msg.type === "isAlive") {
      sendResponse({ isAlive: true });
    }
  });

  /**
   * Currently supports turnstile and anubis
   * @returns {boolean}
   */
  function isCaptchaElementPresent() {
    const possibleSelectors = [
      '.cf-turnstile',
      'script[id=anubis_challenge]'
    ];

    return document.querySelectorAll(possibleSelectors.join(',')).length > 0;
  }
}
mainProcess();
