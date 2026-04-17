const el = (id) => document.getElementById(id);

let cachedPageText = "";
let cachedUrl = "";
let cachedTitle = "";
let quizData = [];
let quizIndex = 0;
let quizAnswers = [];
/** @type {boolean[]} */
let quizRevealed = [];

function setStatus(msg, isError = false) {
  const s = el("status");
  s.textContent = msg || "";
  s.style.color = isError ? "var(--danger)" : "var(--muted)";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureApiKey() {
  const { deepseekApiKey } = await chrome.storage.sync.get("deepseekApiKey");
  const has = Boolean(deepseekApiKey && String(deepseekApiKey).trim());
  el("key-banner").classList.toggle("hidden", has);
  return has;
}

async function ensureAnthropicKey() {
  const { anthropicApiKey } = await chrome.storage.sync.get("anthropicApiKey");
  const has = Boolean(anthropicApiKey && String(anthropicApiKey).trim());
  el("anthropic-banner").classList.toggle("hidden", has);
  return has;
}

async function sendToContent(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function renderList(ulId, items) {
  const ul = el(ulId);
  ul.innerHTML = "";
  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  }
}

function resetQuizUI() {
  quizData = [];
  quizIndex = 0;
  quizAnswers = [];
  quizRevealed = [];
  el("quiz-section").classList.add("hidden");
  el("quiz-score").classList.add("hidden");
  el("quiz-feedback").textContent = "";
  el("quiz-question").textContent = "";
  el("quiz-options").innerHTML = "";
}

function showQuizQuestion() {
  const q = quizData[quizIndex];
  if (!q) return;
  el("quiz-question").textContent = q.question;
  el("quiz-progress").textContent = `${quizIndex + 1} / ${quizData.length}`;
  const opts = el("quiz-options");
  opts.innerHTML = "";
  const letters = ["A", "B", "C", "D"];
  const picked = quizAnswers[quizIndex];
  const reveal = Boolean(quizRevealed[quizIndex]);

  (q.options || []).slice(0, 4).forEach((text, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt-btn";
    b.textContent = `${letters[i]}. ${text}`;
    if (picked === i) b.classList.add("selected");
    if (reveal) {
      if (i === q.correct_index) b.classList.add("correct");
      else if (picked === i && picked !== q.correct_index) b.classList.add("wrong");
      b.disabled = true;
    } else {
      b.addEventListener("click", () => {
        quizAnswers[quizIndex] = i;
        showQuizQuestion();
      });
    }
    opts.appendChild(b);
  });

  const answered = quizAnswers[quizIndex] !== undefined;
  if (!reveal) {
    el("quiz-feedback").textContent = answered ? "" : "Choose the best answer, then click Check answer.";
  } else if (answered) {
    const ok = quizAnswers[quizIndex] === q.correct_index;
    const expl = (q.explanation || "").trim();
    el("quiz-feedback").textContent = expl
      ? `${ok ? "Correct." : "Incorrect."} ${expl}`
      : ok
        ? "Correct."
        : "Incorrect.";
  }

  el("quiz-prev").disabled = quizIndex === 0;
  const last = quizIndex === quizData.length - 1;
  if (!answered) {
    el("quiz-next").textContent = "Check answer";
    el("quiz-next").disabled = true;
  } else if (!reveal) {
    el("quiz-next").textContent = "Check answer";
    el("quiz-next").disabled = false;
  } else if (last) {
    el("quiz-next").textContent = "See score";
    el("quiz-next").disabled = false;
  } else {
    el("quiz-next").textContent = "Next question";
    el("quiz-next").disabled = false;
  }
}

async function loadPageContext() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.", true);
    return null;
  }
  try {
    const res = await sendToContent(tab.id, { type: "GET_PAGE_TEXT" });
    if (!res?.text || res.text.length < 80) {
      setStatus("Not enough text on this page to summarize.", true);
      return null;
    }
    cachedPageText = res.text;
    cachedUrl = res.url || tab.url || "";
    cachedTitle = res.title || "";
    return tab;
  } catch {
    setStatus("Refresh the page and try again (content script not ready).", true);
    return null;
  }
}

el("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
el("open-options-anthropic").addEventListener("click", () => chrome.runtime.openOptionsPage());
el("link-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

el("btn-summarize").addEventListener("click", async () => {
  resetQuizUI();
  el("btn-clear-hl").disabled = true;
  el("summary-section").classList.add("hidden");

  if (!(await ensureApiKey())) {
    setStatus("Set your DeepSeek API key in Options.", true);
    return;
  }

  setStatus("Reading page…");
  const tab = await loadPageContext();
  if (!tab) return;

  setStatus("Asking DeepSeek for main points & highlights…");
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TLDR_SUMMARIZE",
      pageText: cachedPageText,
      pageUrl: cachedUrl,
    });
    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");

    renderList("list-critical", resp.critical_points || []);
    renderList("list-medium", resp.medium_points || []);
    el("summary-section").classList.remove("hidden");

    const quotes = resp.highlight_quotes || [];
    const hl = await sendToContent(tab.id, { type: "APPLY_HIGHLIGHTS", quotes });
    const applied = hl?.applied ?? 0;
    const trunc = resp.truncated ? " (article truncated for API length)" : "";
    setStatus(`Highlighted ${applied} quote(s) on the page.${trunc}`);
    el("btn-clear-hl").disabled = false;
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

el("btn-clear-hl").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await sendToContent(tab.id, { type: "CLEAR_HIGHLIGHTS" });
    setStatus("Highlights cleared.");
  } catch {
    setStatus("Could not clear highlights.", true);
  }
});

el("btn-graph").addEventListener("click", async () => {
  if (!(await ensureAnthropicKey())) {
    setStatus("Set your Anthropic API key in Options (interactive graph).", true);
    return;
  }

  setStatus("Reading page…");
  el("btn-graph").disabled = true;

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.", true);
    el("btn-graph").disabled = false;
    return;
  }

  if (!cachedPageText) {
    await loadPageContext();
  } else {
    try {
      const res = await sendToContent(tab.id, { type: "GET_PAGE_TEXT" });
      if (res?.text) {
        cachedPageText = res.text;
        cachedUrl = res.url || tab.url || "";
        cachedTitle = res.title || "";
      }
    } catch {
      /* use cache */
    }
  }

  if (!cachedPageText) {
    el("btn-graph").disabled = false;
    return;
  }

  setStatus("Asking Anthropic for an interactive graph…");
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TLDR_INTERACTIVE_GRAPH",
      pageText: cachedPageText,
      pageUrl: cachedUrl,
      pageTitle: cachedTitle,
    });
    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");

    await chrome.storage.session.set({
      interactiveGraph: resp.graph,
      graphPageTitle: cachedTitle || "Graph",
      graphPageUrl: cachedUrl,
    });

    const url = chrome.runtime.getURL("graph-viewer.html");
    await chrome.tabs.create({ url });

    const trunc = resp.truncated ? " (article truncated for graph)" : "";
    setStatus(`Opened interactive graph in a new tab.${trunc}`);
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    el("btn-graph").disabled = false;
  }
});

el("btn-quiz").addEventListener("click", async () => {
  if (!(await ensureApiKey())) {
    setStatus("Set your DeepSeek API key in Options.", true);
    return;
  }

  setStatus("Generating tricky quiz…");
  el("btn-quiz").disabled = true;

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.", true);
    el("btn-quiz").disabled = false;
    return;
  }

  if (!cachedPageText) {
    await loadPageContext();
  }
  if (!cachedPageText) {
    el("btn-quiz").disabled = false;
    return;
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TLDR_QUIZ",
      pageText: cachedPageText,
      pageUrl: cachedUrl,
    });
    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
    quizData = Array.isArray(resp.questions) ? resp.questions : [];
    if (!quizData.length) throw new Error("No quiz questions returned.");

    quizIndex = 0;
    quizAnswers = [];
    quizRevealed = quizData.map(() => false);
    el("quiz-section").classList.remove("hidden");
    el("quiz-score").classList.add("hidden");
    showQuizQuestion();

    const trunc = resp.truncated ? " (article truncated for quiz)" : "";
    setStatus(`Quiz ready.${trunc}`);
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    el("btn-quiz").disabled = false;
  }
});

el("quiz-next").addEventListener("click", () => {
  if (!quizData.length) return;

  if (quizAnswers[quizIndex] === undefined) {
    el("quiz-feedback").textContent = "Select an option first.";
    return;
  }

  if (!quizRevealed[quizIndex]) {
    quizRevealed[quizIndex] = true;
    showQuizQuestion();
    return;
  }

  const last = quizIndex === quizData.length - 1;
  if (last) {
    let score = 0;
    quizData.forEach((q, i) => {
      if (quizAnswers[i] === q.correct_index) score++;
    });
    el("quiz-score").textContent = `Score: ${score} / ${quizData.length}`;
    el("quiz-score").classList.remove("hidden");
    el("quiz-next").disabled = true;
    setStatus("Quiz finished.");
    return;
  }

  quizIndex++;
  showQuizQuestion();
});

el("quiz-prev").addEventListener("click", () => {
  if (quizIndex > 0) {
    quizIndex--;
    el("quiz-score").classList.add("hidden");
    el("quiz-next").disabled = false;
    showQuizQuestion();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  ensureApiKey();
  ensureAnthropicKey();
});
