/** @type {Promise<LanguageModel>} */
let classifierRootSession;
/** @type {Promise<LanguageModel>} */
let summarizerRootSession;

/**
 * Get the user's selected language from chrome storage
 * @returns {Promise<string>}
 */
async function getLanguageFromStorage() {
  try {
    const result = await chrome.storage.local.get("language");
    return result.language || "en";
  } catch (e) {
    console.error("Error getting language from storage", e);
    return "en";
  }
}

const tags = [
  // 🧠 Technology
  "machine_learning",
  "deep_learning",
  "artificial_intelligence",
  "neural_networks",
  "cybersecurity",
  "ethical_hacking",
  "blockchain",
  "cryptocurrency",
  "web_development",
  "frontend",
  "backend",
  "full_stack",
  "mobile_apps",
  "ios_development",
  "android_development",
  "cloud_computing",
  "data_science",
  "data_analysis",
  "robotics",
  "automation",
  "internet_of_things",
  "smart_devices",
  "quantum_computing",
  "virtual_reality",
  "augmented_reality",
  "mixed_reality",
  "software_engineering",
  "python",
  "javascript",
  "typescript",
  "rust",
  "go_language",
  "csharp",
  "hardware",
  "microcontrollers",
  "semiconductors",
  "gadgets",
  "gaming",
  "game_development",
  "devops",
  "open_source",
  "ai_ethics",
  "tech_policy",
  "5g",
  "edge_computing",
  "digital_transformation",
  "smart_cities",

  // 🔬 Science
  "space",
  "astronomy",
  "astrophysics",
  "cosmology",
  "physics",
  "particle_physics",
  "biology",
  "microbiology",
  "zoology",
  "botany",
  "chemistry",
  "biochemistry",
  "climate_change",
  "environment",
  "renewable_energy",
  "sustainability_science",
  "genetics",
  "bioinformatics",
  "neuroscience",
  "psychology",
  "paleontology",
  "geology",
  "meteorology",
  "oceanography",
  "marine_biology",
  "ecology",
  "materials_science",
  "nanotechnology",
  "space_exploration",

  // 🏛️ Politics & Society
  "politics",
  "elections",
  "government",
  "public_administration",
  "international_relations",
  "law",
  "human_rights",
  "social_justice",
  "activism",
  "immigration",
  "democracy",
  "geopolitics",
  "public_policy",
  "foreign_policy",
  "conflict_resolution",
  "diplomacy",
  "civic_engagement",
  "freedom_of_speech",
  "privacy_rights",
  "digital_rights",

  // 💼 Business & Finance
  "business",
  "finance",
  "economics",
  "macroeconomics",
  "microeconomics",
  "stock_market",
  "investing",
  "trading",
  "cryptocurrency_trading",
  "startups",
  "venture_capital",
  "entrepreneurship",
  "leadership",
  "real_estate",
  "banking",
  "fintech",
  "corporate",
  "marketing",
  "digital_marketing",
  "branding",
  "ecommerce",
  "supply_chain",
  "product_management",
  "business_strategy",
  "remote_work",
  "future_of_work",

  // ⚽ Sports
  "football",
  "soccer",
  "cricket",
  "basketball",
  "tennis",
  "baseball",
  "olympics",
  "golf",
  "formula_one",
  "motorsport",
  "esports",
  "boxing",
  "mma",
  "cycling",
  "running",
  "swimming",
  "climbing",
  "surfing",
  "skateboarding",
  "fitness_training",

  // 🎬 Entertainment
  "movies",
  "television",
  "streaming",
  "music",
  "pop_music",
  "hiphop",
  "kpop",
  "jazz",
  "indie_music",
  "celebrity",
  "books",
  "literature",
  "theater",
  "art",
  "digital_art",
  "photography",
  "anime",
  "manga",
  "comics",
  "graphic_novels",
  "podcasts",
  "video_production",
  "cinematography",
  "screenwriting",
  "film_reviews",

  // 🩺 Health & Wellness
  "health",
  "medicine",
  "public_health",
  "fitness",
  "nutrition",
  "mental_health",
  "psychotherapy",
  "wellness",
  "mindfulness",
  "meditation",
  "pandemic",
  "vaccines",
  "epidemiology",
  "exercise",
  "yoga",
  "sleep",
  "healthy_lifestyle",
  "sports_medicine",
  "sexual_health",
  "holistic_health",

  // 🏡 Lifestyle
  "food",
  "cooking",
  "recipes",
  "travel",
  "solo_travel",
  "sustainable_travel",
  "fashion",
  "streetwear",
  "beauty",
  "skincare",
  "relationships",
  "dating",
  "parenting",
  "education",
  "higher_education",
  "career",
  "personal_finance",
  "budgeting",
  "home_improvement",
  "interior_design",
  "minimalism",
  "sustainability",
  "gardening",
  "diy_projects",
  "digital_nomad",
  "self_improvement",

  // 🗞️ News & Current Events
  "news",
  "breaking_news",
  "world_news",
  "local_news",
  "investigative_journalism",
  "opinion",
  "fact_checking",
  "media_ethics",
  "press_freedom",
  "social_media_trends",

  // 📚 Culture, History & Philosophy
  "history",
  "ancient_history",
  "modern_history",
  "philosophy",
  "ethics",
  "religion",
  "theology",
  "culture",
  "pop_culture",
  "subcultures",
  "language",
  "linguistics",
  "anthropology",
  "archaeology",
  "literary_analysis",
  "mythology",
  "folklore",
  "sociology",
  "psychology_of_culture",

  // 🚗 Other Topics
  "automotive",
  "electric_vehicles",
  "aviation",
  "drones",
  "military",
  "defense_technology",
  "crime",
  "criminology",
  "forensics",
  "weather",
  "natural_disasters",
  "wildlife",
  "conservation",
  "pets",
  "animal_behavior",
  "agriculture",
  "farming_technology",
  "architecture",
  "urban_planning",
  "design",
  "graphic_design",
  "industrial_design",
  "photography_gear",
  "space_technology",
  "transportation",
  "sustainability_innovation",
  "circular_economy",
];
async function getSummarizerRootSession() {
  if (summarizerRootSession) {
    return summarizerRootSession;
  }
  const language = await getLanguageFromStorage();
  summarizerRootSession = LanguageModel.create({
    initialPrompts: [
      {
        role: "system",
        content: `You will receive a screenshot and the text content of a webpage. Generate the takeaways and the tags for this content.

TAKEAWAYS:
- Each takeaway should be a concrete, actionable insight or key piece of information
- Maximum 30 words per takeaway
- Focus on: main arguments, key facts, important conclusions, practical advice, or significant findings
- Avoid vague statements; be specific and informative
- Avoid redundancy between takeaways
- Ignore advertisements, navigation elements, and boilerplate content

TAGS:
- Select the most relevant tags that accurately categorize the content
- Prioritize specificity over generality
- Choose tags that would help someone searching for this type of content
`,
      },
    ],
    expectedInputs: [
      {
        type: "text",
        languages: ["en" /* system prompt */, language /* user prompt */],
      },
      { type: "image" },
    ],
    expectedOutputs: [{ type: "text", languages: [language] }],
  });
  return classifierRootSession;
}

async function getClassifierRootSession() {
  if (classifierRootSession) {
    return classifierRootSession;
  }
  classifierRootSession = LanguageModel.create({
    initialPrompts: [
      {
        role: "system",
        content: `You will receive a screenshot and the text content of a webpage. You need to check if the webpage matches the following two criteria:

1. webpage should contain exactly one single informational article or one single informational video, with one top level heading, a single named writer/creator and textual content related to that heading
2. webpage should be viewable by many readers, not tied to a single user's account

Examples of webpages matching both the criteria: a Wikipedia article on history, a blog post about Python, a single CNN news piece, a single support thread on a forum, a paid lesson about piano pitches

Examples of webpages not matching the first criteria: the homepage of New York Times, Google Search results page, telephone directory pages

Examples of webpages not matching the second criteria: user's personal bank account page, personal gmail inbox, personal password manager page, personal WhatsApp page, personal health record, Google Cloud admin panel

ONLY IF the webpage matches both of the two criteria, output { "status": "YES" }.
ONLY If the webpage does not match either of the two criteria: output { "status": "NO" }.
Include your reason in brief.
`,
      },
    ],
    expectedInputs: [{ type: "image" }],
  })
  return classifierRootSession;
}

function checkSessionUsage(session) {
  console.log(`${session.inputUsage}/${session.inputQuota}`);
}

/**
 *
 * @param {AbortController} controller
 * @param {boolean} isRetry
 * @returns
 */
async function getNewSummarizerSession(controller, isRetry = false) {
  const rootSession = getSummarizerRootSession();
  /** @type {LanguageModel} */
  let session;
  try {
    session = await (
      await rootSession
    ).clone({
      signal: controller.signal,
    });
  } catch (e) {
    if (!isRetry && e.toString().includes("cannot be cloned")) {
      summarizerRootSession = null;
      return await getNewSummarizerSession(controller, true);
    } else {
      throw e;
    }
  }

  return { session, controller };
}

/**
 *
 * @param {AbortController} controller
 * @param {boolean} isRetry
 * @returns
 */
async function getNewClassifierSession(controller, isRetry = false) {
  const rootSession = getClassifierRootSession();
  /** @type {LanguageModel} */
  let session;
  try {
    session = await (
      await rootSession
    ).clone({
      signal: controller.signal,
    });
  } catch (e) {
    if (!isRetry && e.toString().includes("cannot be cloned")) {
      classifierRootSession = null;
      return getNewClassifierSession(controller, true);
    } else {
      throw e;
    }
  }

  return { session, controller };
}

/**
 * @param {LanguageModel} session
 * @param {string} documentContent
 * @param {Blob} screenshot
 * @param {AbortController} controller
 * @returns
 */
function getOneSummary(session, documentContent, screenshot, controller) {
  return session.prompt(
    [
      {
        role: "user",
        content: [
          { type: "text", value: documentContent },
          { type: "image", value: screenshot },
        ],
      },
    ],
    {
      signal: controller.signal,
      responseConstraint: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            // TODO(bug): if you specify uniqueItems: true here, model will throw a generic error
            items: { enum: tags },
          },
          takeaways: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            // Increase length of sentence otherwise the AI wraps the current sentence into the next one
            items: { type: "string", minLength: 20, maxLength: 200 },
          },
        },
        required: ["tags", "takeaways"],
        additionalProperties: false,
      },
    }
  );
}

/**
 * @param {string} url
 * @param {LanguageModel} session
 * @param {string} documentContent
 * @param {Blob} screenshot
 * @param {AbortController} controller
 * @returns
 */
function getOneClassification(
  url,
  session,
  documentContent,
  screenshot,
  controller
) {
  return session.prompt(
    [
      {
        role: "user",
        content: [
          { type: "text", value: "URL of webpage is: \"" + url + "\"\n\n\n" + documentContent },
          { type: "image", value: screenshot },
        ],
      },
    ],
    {
      signal: controller.signal,
      responseConstraint: {
        type: "object",
        properties: {
          // Maybe putting the reason first helps improve model accuracy?
          reason: {
            type: "string",
            minLength: 100,
            maxLength: 300,
          },
          status: {
            enum: ["NO", "YES"],
          },
        },
        required: ["reason", "status"],
        additionalProperties: false,
      },
    }
  );
}

/**
 * @param {{ screenshot: Blob, documentContent: string[], controller: AbortController, url: string, }} message
 */
export async function getPrediction({
  screenshot,
  documentContent,
  controller,
  url,
}) {
  /** @type {{ session: LanguageModel, }} */
  let session;
  try {
    session = await getNewClassifierSession(controller);
  } catch (e) {
    console.error("Could not get session");
    throw e;
  }
  const start = Date.now();
  let predictionText;
  const [smallContent, bigContent] = documentContent;
  let useContent = bigContent;
  try {
    try {
      predictionText = await getOneClassification(
        url,
        session.session,
        bigContent,
        screenshot,
        controller
      );
    } catch (e) {
      useContent = smallContent;
      if (e.toString().includes("input is too large")) {
        console.log("retrying on small text");
        predictionText = await getOneClassification(
          url,
          session.session,
          smallContent,
          screenshot,
          controller
        );
      } else {
        throw e;
      }
    }
  } catch (e) {
    throw e;
  }
  const end = Date.now();
  console.log("Raw prediction", predictionText);
  console.log("Prompt response time taken", end - start + "ms");
  checkSessionUsage(session.session);
  let prediction;
  try {
    prediction = JSON.parse(predictionText);
  } catch (e) {
    console.error("Invalid JSON");
    console.log(predictionText);
    throw e;
  }
  if (prediction.status !== "YES") {
    return prediction;
  }
  console.log("getting full summary");
  try {
    session = await getNewSummarizerSession(controller);
  } catch (e) {
    console.error("Could not get summarizer session");
    throw e;
  }
  predictionText = await getOneSummary(
    session.session,
    useContent,
    screenshot,
    controller
  );
  try {
    prediction = JSON.parse(predictionText);
  } catch (e) {
    console.error("Invalid JSON");
    console.log(predictionText);
    throw e;
  }

  return prediction;
}