// File: public/app.js
import { renderMarkdown } from "./markdown.js";

const $ = (selector) => document.querySelector(selector);

const els = {
  loginView: $("#login-view"),
  loginForm: $("#login-form"),
  loginError: $("#login-error"),
  loginSubmit: $("#login-submit"),
  accessCode: $("#access-code"),
  appView: $("#app-view"),
  modelSelect: $("#model-select"),
  effortSelect: $("#effort-select"),
  effortControl: $("#effort-control"),
  newChat: $("#new-chat"),
  logout: $("#logout"),
  messages: $("#messages"),
  messagesInner: $("#messages-inner"),
  emptyState: $("#empty-state"),
  composer: $("#composer"),
  input: $("#input"),
  send: $("#send"),
  copyInput: $("#copy-input"),
  sendHint: $("#send-hint"),
  errorBanner: $("#error-banner"),
  errorText: $("#error-text"),
  errorDismiss: $("#error-dismiss"),
};

const state = {
  models: [],
  turns: [],
  streaming: false,
};

const isTouch = window.matchMedia("(pointer: coarse)").matches;
if (isTouch) els.sendHint.textContent = "";

/* ---------- 共通 ---------- */

function showError(message) {
  els.errorText.textContent = message;
  els.errorBanner.hidden = false;
}

function clearError() {
  els.errorBanner.hidden = true;
  els.errorText.textContent = "";
}

async function copyText(text, button) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (button) {
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      button.textContent = "コピーしました";
      setTimeout(() => {
        button.textContent = button.dataset.label;
      }, 1200);
    }
  } catch {
    showError("クリップボードにコピーできませんでした。");
  }
}

/* ---------- 認証 ---------- */

async function checkSession() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

function enterApp() {
  els.loginView.hidden = true;
  els.appView.hidden = false;
  els.input.focus();
}

function enterLogin() {
  els.appView.hidden = true;
  els.loginView.hidden = false;
  els.accessCode.value = "";
  els.accessCode.focus();
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  els.loginSubmit.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ code: els.accessCode.value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      els.loginError.textContent = data.error || "ログインに失敗しました。";
      return;
    }
    await loadModels();
    enterApp();
  } catch {
    els.loginError.textContent = "ネットワークエラーが発生しました。";
  } finally {
    els.loginSubmit.disabled = false;
  }
});

els.logout.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  state.turns = [];
  renderMessages();
  enterLogin();
});

/* ---------- モデル設定 ---------- */

async function loadModels() {
  const res = await fetch("/api/models", { credentials: "same-origin" });
  if (!res.ok) throw new Error("config");
  const data = await res.json();
  state.models = data.models;

  els.modelSelect.innerHTML = "";
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    option.title = model.description;
    els.modelSelect.appendChild(option);
  }
  els.effortSelect.innerHTML = "";
  for (const level of ["low", "medium", "high", "xhigh", "max"]) {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    els.effortSelect.appendChild(option);
  }
  els.effortSelect.value = "high";

  const savedModel = localStorage.getItem("cc.model");
  if (savedModel && state.models.some((m) => m.id === savedModel)) els.modelSelect.value = savedModel;

  syncEffortAvailability();
}

function currentModel() {
  return state.models.find((m) => m.id === els.modelSelect.value);
}

function syncEffortAvailability() {
  const model = currentModel();
  const supported = Boolean(model && model.supportsEffort);
  els.effortSelect.disabled = !supported;
  els.effortControl.classList.toggle("is-disabled", !supported);
  els.effortControl.title = supported ? "" : "このモデルは推論量の指定に対応していません。";
}

els.modelSelect.addEventListener("change", () => {
  localStorage.setItem("cc.model", els.modelSelect.value);
  syncEffortAvailability();
});

/* ---------- 描画 ---------- */

function decorateCodeBlocks(container) {
  for (const pre of container.querySelectorAll("pre")) {
    if (pre.querySelector(".code-copy")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "コピー";
    button.addEventListener("click", () => {
      const code = pre.querySelector("code");
      copyText(code ? code.textContent : "", button);
    });
    pre.appendChild(button);
  }
}

function buildMessageNode(turn, index) {
  const article = document.createElement("article");
  article.className = `msg msg-${turn.role}`;
  article.dataset.index = String(index);

  const head = document.createElement("div");
  head.className = "msg-head";

  const role = document.createElement("span");
  role.className = "msg-role";
  role.textContent = turn.role === "user" ? "You" : "Claude";
  head.appendChild(role);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "btn-quiet";
  copyButton.textContent = "コピー";
  copyButton.addEventListener("click", () => copyText(turn.content, copyButton));
  actions.appendChild(copyButton);
  head.appendChild(actions);

  article.appendChild(head);

  const body = document.createElement("div");
  body.className = "msg-body md";
  if (turn.pending && !turn.content) {
    body.innerHTML = '<p class="caret"></p>';
  } else {
    body.innerHTML = renderMarkdown(turn.content);
    if (turn.pending) body.classList.add("caret");
  }
  decorateCodeBlocks(body);
  article.appendChild(body);

  return article;
}

function renderMessages() {
  els.messagesInner.innerHTML = "";
  if (state.turns.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "メッセージを入力して会話を開始します。";
    els.messagesInner.appendChild(empty);
    return;
  }
  state.turns.forEach((turn, index) => {
    els.messagesInner.appendChild(buildMessageNode(turn, index));
  });
}

let renderQueued = false;
function scheduleStreamRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const index = state.turns.length - 1;
    const node = els.messagesInner.querySelector(`[data-index="${index}"]`);
    const turn = state.turns[index];
    if (!node || !turn) return;
    node.replaceWith(buildMessageNode(turn, index));
    autoScroll();
  });
}

function isNearBottom() {
  const el = els.messages;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

let stickToBottom = true;
els.messages.addEventListener("scroll", () => {
  stickToBottom = isNearBottom();
});

function autoScroll() {
  if (stickToBottom) els.messages.scrollTop = els.messages.scrollHeight;
}

/* ---------- 送信 ---------- */

function setStreaming(active) {
  state.streaming = active;
  els.send.disabled = active || els.input.value.trim().length === 0;
  els.modelSelect.disabled = active;
  els.effortSelect.disabled = active || !currentModel()?.supportsEffort;
}

function autoResize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, window.innerHeight * 0.4)}px`;
}

els.input.addEventListener("input", () => {
  els.send.disabled = state.streaming || els.input.value.trim().length === 0;
  autoResize();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (isTouch || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  els.composer.requestSubmit();
});

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.streaming) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  autoResize();
  sendMessage(text);
});

els.newChat.addEventListener("click", () => {
  if (state.streaming) return;
  state.turns = [];
  clearError();
  renderMessages();
  els.input.focus();
});

els.copyInput.addEventListener("click", () => copyText(els.input.value, els.copyInput));
els.errorDismiss.addEventListener("click", clearError);

async function readError(response) {
  try {
    const data = await response.json();
    if (typeof data.error === "string") return data.error;
  } catch {
    /* ignore */
  }
  return "エラーが発生しました。時間をおいて再試行してください。";
}

async function sendMessage(text) {
  clearError();
  stickToBottom = true;

  const history = state.turns
    .filter((turn) => turn.content.trim() !== "")
    .map((turn) => ({ role: turn.role, content: turn.content }));
  history.push({ role: "user", content: text });

  state.turns.push({ role: "user", content: text });
  const assistant = { role: "assistant", content: "", pending: true };
  state.turns.push(assistant);
  renderMessages();
  autoScroll();

  setStreaming(true);
  const model = currentModel();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        model: model ? model.id : undefined,
        effort: model && model.supportsEffort ? els.effortSelect.value : undefined,
        messages: history,
      }),
    });

    if (res.status === 401) {
      enterLogin();
      throw new Error("セッションの有効期限が切れました。もう一度ログインしてください。");
    }
    if (!res.ok || !res.body) {
      throw new Error(await readError(res));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "delta") {
          assistant.content += event.text;
          scheduleStreamRender();
        } else if (event.type === "error") {
          streamError = event.message || "応答の生成中にエラーが発生しました。";
        }
      }
    }

    assistant.pending = false;
    renderMessages();
    autoScroll();

    if (streamError) {
      showError(streamError);
    } else if (!assistant.content) {
      showError("応答を取得できませんでした。もう一度お試しください。");
    }
  } catch (err) {
    assistant.pending = false;
    if (!assistant.content) {
      // 送信自体が失敗: ユーザーメッセージを含めて取り消し、入力を復元
      state.turns.splice(state.turns.length - 2, 2);
      els.input.value = text;
      autoResize();
    }
    renderMessages();
    showError(err && err.message ? err.message : "エラーが発生しました。");
  } finally {
    setStreaming(false);
    els.input.focus();
  }
}

/* ---------- 起動 ---------- */

(async function init() {
  const authenticated = await checkSession();
  if (authenticated) {
    try {
      await loadModels();
      enterApp();
      return;
    } catch {
      /* フォールスルーしてログイン画面へ */
    }
  }
  enterLogin();
})();
