const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Required for non-server clients (Chrome extension BYOK). See Anthropic CORS docs. */
const ANTHROPIC_BROWSER_HEADERS = {
  "anthropic-dangerous-direct-browser-access": "true",
};
/** Interactive concept graph (JSON → vis-network in viewer). See Anthropic models docs. */
const ANTHROPIC_MODEL_GRAPH = "claude-sonnet-4-6";
/** Cheapest/fastest for key validation only (1 token). */
const ANTHROPIC_MODEL_PING = "claude-haiku-4-5";

async function getApiKey() {
  const { deepseekApiKey } = await chrome.storage.sync.get("deepseekApiKey");
  return deepseekApiKey?.trim() || "";
}

async function getAnthropicApiKey() {
  const { anthropicApiKey } = await chrome.storage.sync.get("anthropicApiKey");
  return anthropicApiKey?.trim() || "";
}

async function anthropicMessages(apiKey, systemPrompt, userContent, maxTokens, modelId) {
  const key = apiKey?.trim();
  if (!key) throw new Error("Add your Anthropic API key in extension options.");
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      ...ANTHROPIC_BROWSER_HEADERS,
    },
    body: JSON.stringify({
      model: modelId || ANTHROPIC_MODEL_GRAPH,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || "Anthropic request failed";
    throw new Error(msg);
  }
  const blocks = data?.content;
  if (!Array.isArray(blocks)) throw new Error("Unexpected Anthropic response.");
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text.trim()) throw new Error("Empty response from Anthropic.");
  return text.trim();
}

async function testAnthropicKey(apiKey) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    return { ok: false, error: "No API key entered." };
  }
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      ...ANTHROPIC_BROWSER_HEADERS,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL_PING,
      max_tokens: 1,
      messages: [{ role: "user", content: "Reply with only: ok" }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || res.statusText || "Request failed";
    const lower = String(errMsg).toLowerCase();
    const invalid =
      res.status === 401 ||
      res.status === 403 ||
      lower.includes("invalid") ||
      lower.includes("authentication") ||
      lower.includes("api key");
    return {
      ok: false,
      error: invalid ? `Invalid API key or not authorized. (${errMsg})` : `Connection failed. (${errMsg})`,
    };
  }
  return { ok: true };
}

/**
 * Minimal request to verify the key can authenticate (BYOK — no embedded keys).
 * Uses one token so cost is negligible.
 */
async function testDeepSeekKey(apiKey) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    return { ok: false, error: "No API key entered." };
  }
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
      temperature: 0,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || res.statusText || "Request failed";
    const lower = String(errMsg).toLowerCase();
    const invalid =
      res.status === 401 ||
      res.status === 403 ||
      lower.includes("invalid") ||
      lower.includes("authentication") ||
      lower.includes("unauthorized") ||
      lower.includes("api key");
    return {
      ok: false,
      error: invalid ? `Invalid API key or not authorized. (${errMsg})` : `Connection failed. (${errMsg})`,
    };
  }
  return { ok: true };
}

async function deepSeekChat(messages, options = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Add your DeepSeek API key in extension options (right-click the icon → Options).");
  }
  const body = {
    model: "deepseek-chat",
    messages,
    temperature: options.temperature ?? 0.35,
    ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
  };
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || "API request failed";
    throw new Error(msg);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from DeepSeek.");
  return text;
}

function parseJsonLoose(raw) {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return valid JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeGraphJson(parsed) {
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  if (rawNodes.length === 0) {
    throw new Error("Graph JSON must include a non-empty nodes array.");
  }
  const nodes = [];
  const seen = new Set();
  for (let i = 0; i < rawNodes.length; i++) {
    const n = rawNodes[i];
    const id = String(n.id ?? n.node_id ?? `n${i}`).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({
      id,
      label: String(n.label ?? n.name ?? n.title ?? id).slice(0, 200),
      group: String(n.group ?? n.category ?? "concept").slice(0, 80),
    });
  }
  if (nodes.length === 0) {
    throw new Error("No valid nodes in graph JSON.");
  }
  const idSet = new Set(nodes.map((x) => x.id));
  const edges = [];
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    const from = String(e.from ?? e.source ?? e.src ?? "").trim();
    const to = String(e.to ?? e.target ?? e.dst ?? "").trim();
    if (!from || !to || !idSet.has(from) || !idSet.has(to)) continue;
    const label = e.label != null ? String(e.label).slice(0, 160) : "";
    edges.push({ from, to, label });
  }
  return { title, nodes, edges };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "TLDR_TEST_KEY") {
    (async () => {
      try {
        const result = await testDeepSeekKey(msg.apiKey);
        sendResponse(result);
      } catch (e) {
        sendResponse({
          ok: false,
          error: e.message || String(e) || "Connection test failed.",
        });
      }
    })();
    return true;
  }

  if (msg?.type === "TLDR_TEST_ANTHROPIC_KEY") {
    (async () => {
      try {
        const result = await testAnthropicKey(msg.apiKey);
        sendResponse(result);
      } catch (e) {
        sendResponse({
          ok: false,
          error: e.message || String(e) || "Connection test failed.",
        });
      }
    })();
    return true;
  }

  if (msg?.type === "TLDR_INTERACTIVE_GRAPH") {
    (async () => {
      try {
        const apiKey = await getAnthropicApiKey();
        if (!apiKey) {
          sendResponse({
            ok: false,
            error: "Add your Anthropic API key in Options (used for the interactive graph).",
          });
          return;
        }
        const { pageText, pageUrl, pageTitle } = msg;
        const truncated = pageText.length > 36000;
        const text = truncated ? pageText.slice(0, 36000) : pageText;
        const system = `You output ONLY valid JSON (no markdown fences, no commentary) for an interactive concept graph of the article.

Exact shape:
{
  "title": "Short title for the visualization",
  "nodes": [
    { "id": "unique_id", "label": "Short label in the node", "group": "theme_cluster" }
  ],
  "edges": [
    { "from": "source_node_id", "to": "target_node_id", "label": "relationship (how they connect)" }
  ]
}

Rules:
- 14–36 nodes for long articles; fewer if the article is short.
- ids: unique, use lowercase_snake_case or short alphanumeric only (no spaces in ids).
- label: concise (under ~80 chars), readable; language matches the article.
- group: cluster by theme so colors can differ (e.g. "concept", "problem", "solution", "tool", "step", "author", "example").
- Every edge MUST include a meaningful label: a short verb or phrase (e.g. "causes", "depends on", "implements", "contrasts with", "example of", "leads to").
- Only include edges supported by the article; do not invent facts.
- The graph must be connected or mostly connected; avoid orphan nodes unless necessary.`;

        const user = `Page title: ${pageTitle || "(unknown)"}\nURL: ${pageUrl || "(unknown)"}\n\nArticle:\n${text}${truncated ? "\n\n[TRUNCATED_FOR_LENGTH]" : ""}`;

        const raw = await anthropicMessages(apiKey, system, user, 8192, ANTHROPIC_MODEL_GRAPH);
        const parsed = parseJsonLoose(raw);
        const graph = normalizeGraphJson(parsed);
        sendResponse({ ok: true, graph, truncated });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "TLDR_SUMMARIZE") {
    (async () => {
      try {
        const { pageText, pageUrl } = msg;
        const truncated = pageText.length > 48000;
        const text = truncated ? pageText.slice(0, 48000) : pageText;
        const system = `You are an expert reader. Output ONLY valid JSON (no markdown fences) with this exact shape:
{
  "critical_points": ["string", ...],
  "medium_points": ["string", ...],
  "highlight_quotes": ["string", ...]
}
Rules:
- critical_points: 4–8 bullets of the most important ideas (concise, not repeating the title).
- medium_points: 4–8 supporting points of medium importance.
- highlight_quotes: 6–14 SHORT verbatim excerpts copied EXACTLY from the user's article text (each 20–220 chars). Choose phrases that anchor the critical ideas so they can be found with text search. No paraphrasing—must be substring matches from the provided article.
- If the article is short, use fewer items but keep the structure.
- Language: match the article's language.`;

        const user = `Page URL: ${pageUrl || "(unknown)"}\n\nArticle text:\n${text}${truncated ? "\n\n[TRUNCATED_FOR_LENGTH]" : ""}`;

        const raw = await deepSeekChat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonObject: true }
        );
        const parsed = parseJsonLoose(raw);
        sendResponse({
          ok: true,
          critical_points: Array.isArray(parsed.critical_points) ? parsed.critical_points : [],
          medium_points: Array.isArray(parsed.medium_points) ? parsed.medium_points : [],
          highlight_quotes: Array.isArray(parsed.highlight_quotes) ? parsed.highlight_quotes : [],
          truncated,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "TLDR_QUIZ") {
    (async () => {
      try {
        const { pageText, pageUrl } = msg;
        const truncated = pageText.length > 40000;
        const text = truncated ? pageText.slice(0, 40000) : pageText;
        const system = `You write HARD multiple-choice quizzes. Output ONLY valid JSON (no markdown) with this shape:
{
  "questions": [
    {
      "question": "string",
      "options": ["A","B","C","D"],
      "correct_index": 0,
      "explanation": "string"
    }
  ]
}
Rules:
- Create exactly 7 questions.
- Questions must be TRICKY: subtle distinctions, "which is NOT", edge cases, implications, ordering, or scenarios that only make sense if someone understood nuance—not lazy keyword recall.
- Four options each; exactly one correct. correct_index is 0-3.
- Base everything strictly on the article; do not invent facts not supported by the text.
- explanation: 1–2 sentences why the correct option follows from the article (no fluff).
- Match the article's language.`;

        const user = `Page URL: ${pageUrl || "(unknown)"}\n\nArticle text:\n${text}${truncated ? "\n\n[TRUNCATED_FOR_LENGTH]" : ""}`;

        const raw = await deepSeekChat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonObject: true, temperature: 0.55 }
        );
        const parsed = parseJsonLoose(raw);
        let questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        questions = questions.map((q) => {
          const opts = Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [];
          while (opts.length < 4) opts.push("—");
          let ci = Number(q.correct_index);
          if (!Number.isFinite(ci)) ci = 0;
          ci = Math.max(0, Math.min(3, Math.floor(ci)));
          return {
            question: String(q.question || ""),
            options: opts,
            correct_index: ci,
            explanation: String(q.explanation || ""),
          };
        });
        sendResponse({ ok: true, questions, truncated });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  return false;
});
