function setMsg(el, text, kind) {
  el.textContent = text;
  el.className =
    kind === "ok" ? "status ok" : kind === "err" ? "status err" : kind === "testing" ? "status testing" : "status";
}

function wireForm({ formId, inputId, msgId, storageKey, testMessageType }) {
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  const msg = document.getElementById(msgId);
  const submitBtn = form.querySelector('button[type="submit"]');

  chrome.storage.sync.get(storageKey, (data) => {
    if (data[storageKey]) input.value = data[storageKey];
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = input.value.trim();

    if (!key) {
      chrome.storage.sync.set({ [storageKey]: "" }, () => {
        setMsg(msg, "Key cleared. Nothing is stored.", "ok");
      });
      return;
    }

    submitBtn.disabled = true;
    setMsg(msg, "Testing connection…", "testing");

    try {
      const result = await chrome.runtime.sendMessage({ type: testMessageType, apiKey: key });
      if (result?.ok) {
        chrome.storage.sync.set({ [storageKey]: key }, () => {
          setMsg(msg, "Connection OK. Key saved.", "ok");
        });
      } else {
        setMsg(msg, result?.error || "Invalid key or connection failed. Key was not saved.", "err");
      }
    } catch (err) {
      setMsg(msg, err?.message || "Could not complete the test. Check your network or try again.", "err");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

wireForm({
  formId: "form-deepseek",
  inputId: "key-deepseek",
  msgId: "msg-deepseek",
  storageKey: "deepseekApiKey",
  testMessageType: "TLDR_TEST_KEY",
});

wireForm({
  formId: "form-anthropic",
  inputId: "key-anthropic",
  msgId: "msg-anthropic",
  storageKey: "anthropicApiKey",
  testMessageType: "TLDR_TEST_ANTHROPIC_KEY",
});
