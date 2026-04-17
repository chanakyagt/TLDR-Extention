const MARK_CLASS = "tldr-ds-highlight";
const WRAP_ID = "tldr-ds-highlight-style";

function ensureStyle() {
  if (document.getElementById(WRAP_ID)) return;
  const style = document.createElement("style");
  style.id = WRAP_ID;
  style.textContent = `
    mark.${MARK_CLASS} {
      background: linear-gradient(120deg, rgba(255, 214, 10, 0.45) 0%, rgba(255, 180, 0, 0.35) 100%);
      color: inherit;
      padding: 0.06em 0.12em;
      border-radius: 2px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .${MARK_CLASS}-wrap {
      position: relative;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function clearHighlights() {
  document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function normalizeWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

function findInTextNode(node, search, startOffset) {
  const text = node.textContent;
  const idx = text.indexOf(search, startOffset);
  return idx >= 0 ? { node, start: idx, end: idx + search.length } : null;
}

function textWalker(doc) {
  return doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement.tagName;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}

/** Find first occurrence of quote in document; try full string then shorter prefixes. */
function findRangeForQuote(doc, quoteRaw) {
  const full = quoteRaw.trim();
  if (full.length < 8) return null;

  const candidates = [];
  candidates.push(full);
  if (full.length > 160) candidates.push(full.slice(0, 160).trim());
  if (full.length > 100) candidates.push(full.slice(0, 100).trim());
  const collapsed = normalizeWs(full);
  if (collapsed.length >= 12 && collapsed !== full) candidates.push(collapsed);

  for (const cand of candidates) {
    if (cand.length < 8) continue;
    const walker = textWalker(doc);
    let node;
    while ((node = walker.nextNode())) {
      const hit = findInTextNode(node, cand, 0);
      if (hit) {
        const range = doc.createRange();
        range.setStart(hit.node, hit.start);
        range.setEnd(hit.node, hit.end);
        return range;
      }
    }
  }

  return null;
}

function wrapRange(range) {
  if (!range || range.collapsed) return false;
  try {
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    mark.setAttribute("data-tldr", "1");
    range.surroundContents(mark);
    return true;
  } catch {
    try {
      const contents = range.extractContents();
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.appendChild(contents);
      range.insertNode(mark);
      return true;
    } catch {
      return false;
    }
  }
}

function extractArticleText() {
  const selectors = [
    "article",
    "main",
    '[role="main"]',
    ".post-content",
    ".entry-content",
    ".article-content",
    ".post-body",
    "#content article",
    "#article",
    "#main-content",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const t = el.innerText || "";
    if (t.replace(/\s+/g, " ").trim().length > 400) {
      return { text: t, root: el };
    }
  }
  const body = document.body;
  if (!body) return { text: "", root: document.documentElement };
  return { text: body.innerText || "", root: body };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PAGE_TEXT") {
    const { text, root } = extractArticleText();
    const clean = text.replace(/\s+/g, " ").trim();
    sendResponse({
      text: clean,
      url: location.href,
      title: document.title || "",
      rootSelector: root?.id ? `#${CSS.escape(root.id)}` : root?.tagName?.toLowerCase() || "body",
    });
    return false;
  }

  if (msg?.type === "APPLY_HIGHLIGHTS") {
    ensureStyle();
    clearHighlights();
    const quotes = Array.isArray(msg.quotes) ? msg.quotes : [];
    let applied = 0;
    const used = new Set();
    for (const q of quotes) {
      const key = String(q).slice(0, 200);
      if (used.has(key)) continue;
      used.add(key);
      const range = findRangeForQuote(document, String(q));
      if (range && wrapRange(range)) applied++;
    }
    sendResponse({ ok: true, applied });
    return false;
  }

  if (msg?.type === "CLEAR_HIGHLIGHTS") {
    clearHighlights();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
