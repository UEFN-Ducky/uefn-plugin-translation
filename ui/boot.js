/**
 * Translation plugin shell.boot — sequential language transitions, one walker,
 * seed-first LLM batches with real percent. Never sync-walk document.body.
 */
(function () {
  "use strict";

  var PLUGIN_ID = "translation";
  /** Small batches — large JSON times out and wastes tokens. */
  var FLUSH_CHUNK = 12;
  var MAX_PENDING = 80;
  /**
   * HARD CAP — without this, partial LLM misses re-queue forever (hundreds of
   * requests / millions of tokens for the same strings).
   */
  var MAX_LLM_CALLS_PER_RUN = 36;
  var MAX_ATTEMPTS_PER_STRING = 2;
  /** Cap sync work per turn so React / the file tree stay interactive. */
  var SLICE_MS = 4;
  var ATTRS = ["title", "placeholder", "aria-label"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1 };
  var NON_TRANSLATABLE =
    /^(?:[\d\s.,:;!?'"“”‘’\-–—_/\\|@#%&+=*()[\]{}<>~`$^]+|https?:\/\/\S+|[\w.-]+\/[\w./-]+|[A-Za-z0-9_.-]{1,3})$/;
  /** Code ids only — snake_case / camelCase. NEVER Title Case (Support, Store, …). */
  var IDENTIFIER_LIKE = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]*)$/;
  /** Long enough for Settings blurbs; seed still covers the longest chrome strings. */
  var MAX_DISCOVER_LEN = 220;
  /** Chat bubbles (user asks + answers) — longer than chrome labels. */
  var MAX_CHAT_DISCOVER_LEN = 4000;

  var SYSTEM =
    "You are a professional UI localizer for a desktop app (UEFN Ducky).\n\n" +
    "You receive ONE BATCH: a JSON object. Keys and values are the SAME English UI strings.\n" +
    "Translate EVERY value into the target language. Return ONLY JSON with the SAME keys.\n" +
    "No markdown fences, no commentary, no missing keys.\n\n" +
    "Rules:\n" +
    "- Preserve placeholders like {name}, {{count}}, %s, %d\n" +
    "- Preserve ellipses (… / ...), em-dashes, and leading/trailing whitespace shape\n" +
    "- ALWAYS translate UI chrome labels even if they contain product words\n" +
    "- Keep only standalone product/code tokens untranslated when the WHOLE string is just that token\n" +
    "- Do not add quotes around values unless the source had them\n" +
    "- Keep roughly the same length when possible (UI labels are short)\n";

  /** Seed strings grouped for the skeleton progress panel. */
  var SEED_CATEGORIES = [
    {
      id: "settings",
      label: "Settings",
      strings: [
        "Support", "Account", "Store", "General", "Duckies", "Plans", "LLMs", "Languages",
        "Discord Bot", "Skills & MCP", "Source Control", "Appearance", "Log & Errors",
        "Skills", "MCPs", "Log", "Errors", "Settings", "UI language", "Translation model",
        "Your languages", "Model", "Clear cache for this language", "Default Model",
        "Providers", "Test & Save", "Translate Plans", "Live progress",
        "Auto-translate all Verse files", "Auto-translate all chats",
        "Same catalog as Settings → LLMs Default Model",
        "Default model (Settings → LLMs)",
        "Only languages you add appear here. Click one to apply it to the UI.",
        "UI translate runs in the background. Minimize or hide the floating panel anytime — the bar and phrase list always stay here.",
        "Add the languages you want, pick an AI model to translate UI chrome, then select a language. Sidebar folders, Duckies, and panels translate too. Hover a Verse file or Ducky tab for Translate / Auto translate for that tab only. Code editors and file paths stay original. Translations are cached so each phrase is translated once.",
        "When on, open Plan tabs show a translated view of the plan (title, overview, body). Off by default — plans stay English until you enable this.",
        "When on, opening any .verse file also opens a visual translation. Turn Auto off on a file’s hover card to exclude just that file.",
        "When on, chat messages translate for every ducky. Turn Auto off on a chat’s hover card to exclude just that chat.",
        "Same model list as Settings → LLMs. Empty uses your Default Model. API providers work best; Cursor / Claude Code / Codex often hang on batch UI translate.",
        "Same catalog as Default Model. Prefer Anthropic / OpenAI / Google / Ollama for UI + file translate.",
        "Unknown language", "Did you mean…?", "English (off)", "default", "active", "click to apply",
      ],
    },
    {
      id: "chrome",
      label: "Chrome",
      strings: [
        "Discord Ducky", "Discord", "Placement", "Connection", "Show in header",
        "Show in left sidebar", "Show in right sidebar", "Web Browser", "Browser",
        "Add", "Remove", "Install", "Update", "Enable", "Disable",
        "Cancel", "Save", "Close", "Open", "Delete", "Rename", "Copy", "Paste",
        "New chat", "New folder", "Level Design", "Python",
        "Duckies", "Tester", "Group", "Archive", "Focus", "Change ducky",
        "Hide subagents", "Subagent", "Delete permanently",
        "No archived duckies", "No archived duckies match", "Return to active",
        "Expand all", "Collapse all", "UEFN Core",
      ],
    },
    {
      id: "editor",
      label: "Editor",
      strings: [
        "Verse", "Content", "Outline", "History", "Search", "Filter", "Search…",
        "Replace in Verse files", "View raw", "Loading symbols…",
        "No symbols in this file", "No symbols match the filter",
        "Open a file to see history", "Open a Verse file to see symbols",
        "Loading…", "Loading project…", "Loading Verse editor…", "Loading editor…",
        "Saving…", "Unsaved", "Saved", "LSP connected", "LSP starting", "LSP error",
        "This file can’t be opened in the editor.", "Dismiss preview", "Dismiss",
        "Your unsaved changes are preserved.",
        // Hover cards mount on demand — seed so language-on hover never flashes English.
        "Unsaved changes", "Visual translate", "Visual translate (read-only)",
        "Visual translate…", "Translate", "Auto translate", "Auto on", "Translate chat",
        "Agent working", "Response ready", "Subducky",
        "Ask", "Agent", "Linked file:",
      ],
    },
    {
      id: "chat",
      label: "Chat",
      strings: ["Send to ducky", "Reuse", "Edit", "PLAN", "Plan", "Details"],
    },
    {
      id: "store",
      label: "Store",
      strings: [
        "Trending", "Installed", "Gateways", "Themes", "Games", "Plugins",
        "Featured", "Most installed", "Community favorite", "Update available",
        "Search plugins, skills, tags…", "All Categories", "Search store",
        "Filter by category", "Install from file…", "Install from file",
        "Open plugins folder", "Refresh catalog", "DuckyOS Store", "Local file",
        "Bundled", "Skill pack", "Plugin", "Free", "Owned", "installs", "local",
        "Update", "Install", "Uninstall", "Enable", "Disable", "Enable Plugin",
        "Disable Plugin", "Coming soon", "Working…", "No description.",
        "Downloading pack", "Installing", "Refreshing store", "Done",
        "Loading catalog", "Loading store…",
        "About this skill pack", "About this plugin", "Tags & categories",
        "Version", "Installs", "Source", "Price",
      ],
    },
  ];

  var CORE_SEED = (function () {
    var out = [];
    var seen = {};
    for (var c = 0; c < SEED_CATEGORIES.length; c++) {
      var list = SEED_CATEGORIES[c].strings;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!seen[s]) {
          seen[s] = 1;
          out.push(s);
        }
      }
    }
    return out;
  })();

  var CATEGORY_BY_STRING = (function () {
    var map = {};
    for (var c = 0; c < SEED_CATEGORIES.length; c++) {
      var cat = SEED_CATEGORIES[c];
      for (var i = 0; i < cat.strings.length; i++) map[cat.strings[i]] = cat.label;
    }
    return map;
  })();

  function host() {
    var root = window.__duckyPluginHost;
    if (!root) return null;
    if (typeof root.forPlugin === "function") return root.forPlugin(PLUGIN_ID);
    return root.pluginId === PLUGIN_ID ? root : null;
  }

  // ── state ──────────────────────────────────────────────────────────
  var activeLang = "";
  var activeModel = "";
  var catalog = {};
  /** Previous catalog values — block storing them as English originals during switch. */
  var priorValues = new Set();
  var pending = new Set();
  var originalsText = new WeakMap();
  var originalsAttr = new WeakMap();
  var skipCache = new WeakMap();
  var observer = null;
  var progressEl = null; // floating overlay (dismissible)
  var progressEmbedded = null; // Languages tab host (always available while mounted)
  var hideTimer = null;
  var hostWatcher = null;
  /** null until first prefs sync — leftover translateStart must not auto-run. */
  var lastStartToken = null;
  /** src -> { src, cat, status: queued|active|done|error, value } */
  var jobItems = {};
  var progressExpanded = false;
  var overlayHidden = false;
  var overlayMinimized = false;
  var lastProgress = { state: "idle", message: "", lang: "", percent: null };
  /** After first apply — discovery flushes stay quiet on floating (Languages still updates). */
  var chromeReady = false;
  var seedReady = false;
  var stopped = true;
  /**
   * Desired language (coalesced). Rapid Add/clicks only keep the latest —
   * never run Spanish→French→German back-to-back (that "belches" between langs).
   */
  var desiredLang = "en";
  var desiredModel = "";
  var pumpBusy = false;
  var runId = 0;
  /** Serialize LLM flushes — parallel drainPending fights over pending/catalog. */
  var flushTail = Promise.resolve();

  // Single walker — mutations enqueue roots; never spawn parallel walks.
  var walkRoots = [];
  var walkBusy = false;
  var walkGen = 0;
  var walkOnIdle = null;
  var mutateTimer = null;
  var flushTimer = null;
  /** Per-run LLM budget + per-string attempts (prevents infinite re-translate). */
  var llmCallsThisRun = 0;
  var attemptCounts = {};

  function isEnglish(lang) {
    var c = String(lang || "").trim().toLowerCase();
    return !c || c === "en" || c === "eng" || c === "english";
  }

  /** Collapse JSX whitespace so seed keys match DOM text nodes. */
  function normKey(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function catalogGet(trimmed) {
    var t = normKey(trimmed);
    if (!t) return undefined;
    if (typeof catalog[t] === "string") return catalog[t];
    if (typeof catalog[trimmed] === "string") return catalog[trimmed];
    return undefined;
  }

  function catalogHas(trimmed) {
    return catalogGet(trimmed) !== undefined;
  }

  function isTranslatableString(text) {
    var t = normKey(text);
    if (!t || t.length < 2) return false;
    if (NON_TRANSLATABLE.test(t)) return false;
    if (IDENTIFIER_LIKE.test(t)) return false;
    if (t.indexOf("/") >= 0 || t.indexOf("\\") >= 0 || /\.(verse|ts|tsx|js|json|md)$/i.test(t)) return false;
    try {
      if (!/\p{L}/u.test(t)) return false;
    } catch (_) {
      if (!/[A-Za-z\u00C0-\u024F]/.test(t)) return false;
    }
    return true;
  }

  function shouldSkipElement(el) {
    if (!el || !(el instanceof Element)) return true;
    var hit = skipCache.get(el);
    if (hit !== undefined) return hit;
    // Duckies/file trees translate. Chat bodies opt out via data-no-translate (per-chat toggle clears it).
    // Skip thinking dumps — Translate chat targets user asks + assistant replies, not reasoning.
    var skip = !!(
      el.closest("[data-no-translate]") ||
      el.closest(".monaco-editor") ||
      el.closest(".xterm") ||
      el.closest("[contenteditable='true']") ||
      el.closest(".thinking-block-body") ||
      el.closest(".verse-outline-name") ||
      el.closest(".file-editor-source") ||
      el.closest(".file-editor-pane") ||
      el.closest(".verse-editor-container") ||
      el.closest(".verse-editor-body") ||
      el.closest(".verse-translated-pane") ||
      el.closest(".tool-file-edit-diff") ||
      SKIP_TAGS[el.tagName]
    );
    skipCache.set(el, skip);
    return skip;
  }

  function isKnownTranslationValue(trimmed) {
    if (!trimmed) return false;
    if (priorValues.has(trimmed)) return true;
    for (var k in catalog) {
      if (catalog[k] === trimmed) return true;
    }
    return false;
  }

  // ── progress: floating (dismissible) + Languages tab embed ─────────
  function ensureProgressStyles() {
    if (document.getElementById("uefn-translation-progress-css")) return;
    var style = document.createElement("style");
    style.id = "uefn-translation-progress-css";
    style.textContent =
      ".translation-progress{position:fixed;top:0;left:0;right:0;z-index:9999;pointer-events:none;}" +
      ".translation-progress.is-overlay-hidden{display:none!important;}" +
      ".translation-progress-track{height:3px;background:transparent;pointer-events:auto;cursor:pointer;}" +
      ".translation-progress-fill{height:100%;background:#5865f2;width:0%;transition:width .25s ease;}" +
      ".translation-progress-fill.is-indeterminate{width:30%;animation:uefn-tr-slide 1.1s ease-in-out infinite;}" +
      ".translation-progress.is-error .translation-progress-fill{background:#e35d6a;}" +
      ".translation-progress.is-done .translation-progress-fill{background:#3ba55d;}" +
      ".translation-progress-panel{position:absolute;top:8px;right:12px;width:min(380px,calc(100vw - 24px));" +
      "pointer-events:auto;background:rgba(22,23,28,.96);color:#e8e8ea;border:1px solid #2e2f36;" +
      "border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);overflow:hidden;}" +
      ".translation-progress.is-minimized .translation-progress-panel{display:none;}" +
      ".translation-progress.is-error .translation-progress-panel{border-color:#e35d6a;}" +
      ".translation-progress-chip{display:flex;align-items:center;gap:6px;padding:8px 10px;" +
      "font:12px/1.35 system-ui,sans-serif;user-select:none;}" +
      ".translation-progress-chip-label{flex:1;min-width:0;cursor:pointer;}" +
      ".translation-progress-chip-label:hover{opacity:.9;}" +
      ".translation-progress-btn{flex-shrink:0;width:22px;height:22px;border:0;border-radius:4px;" +
      "background:transparent;color:#c8c8ce;font:14px/1 system-ui,sans-serif;cursor:pointer;padding:0;}" +
      ".translation-progress-btn:hover{background:rgba(255,255,255,.08);color:#fff;}" +
      ".translation-progress-chevron{opacity:.7;font-size:10px;transition:transform .15s;cursor:pointer;padding:4px;}" +
      ".translation-progress.is-open .translation-progress-chevron{transform:rotate(180deg);}" +
      ".translation-progress-body{display:none;max-height:min(50vh,420px);overflow:auto;" +
      "border-top:1px solid #2e2f36;padding:8px 10px 10px;font:11px/1.35 system-ui,sans-serif;}" +
      ".translation-progress.is-open .translation-progress-body{display:block;}" +
      ".translation-progress-cat{margin:8px 0 4px;color:#9aa0a6;font-weight:600;text-transform:uppercase;" +
      "letter-spacing:.04em;font-size:10px;}" +
      ".translation-progress-cat:first-child{margin-top:0;}" +
      ".translation-progress-row{display:grid;grid-template-columns:14px 1fr;gap:6px;align-items:start;" +
      "padding:4px 2px;border-radius:4px;}" +
      ".translation-progress-row.is-active{background:rgba(88,101,242,.12);}" +
      ".translation-progress-dot{width:8px;height:8px;border-radius:50%;margin-top:3px;background:#3a3b42;}" +
      ".translation-progress-row.is-queued .translation-progress-dot{" +
      "background:linear-gradient(90deg,#3a3b42 25%,#555 50%,#3a3b42 75%);background-size:200% 100%;" +
      "animation:uefn-tr-skel 1.2s linear infinite;}" +
      ".translation-progress-row.is-active .translation-progress-dot{background:#5865f2;}" +
      ".translation-progress-row.is-done .translation-progress-dot{background:#3ba55d;}" +
      ".translation-progress-row.is-error .translation-progress-dot{background:#e35d6a;}" +
      ".translation-progress-src{color:#c8c8ce;word-break:break-word;}" +
      ".translation-progress-dst{color:#8b8f98;margin-top:2px;word-break:break-word;}" +
      ".translation-progress-row.is-queued .translation-progress-dst{" +
      "height:10px;width:55%;border-radius:3px;background:linear-gradient(90deg,#2a2b32 25%,#3a3b42 50%,#2a2b32 75%);" +
      "background-size:200% 100%;animation:uefn-tr-skel 1.2s linear infinite;color:transparent;}" +
      ".translation-progress-row.is-active .translation-progress-dst{color:#a8b0ff;}" +
      ".translation-progress--embedded{position:static;z-index:auto;pointer-events:auto;margin:0;}" +
      ".translation-progress--embedded .translation-progress-track{border-radius:3px;background:rgba(255,255,255,.06);cursor:default;}" +
      ".translation-progress--embedded .translation-progress-panel{position:static;width:100%;margin-top:8px;" +
      "box-shadow:none;background:var(--panel-bg,rgba(22,23,28,.6));border-color:var(--border,#2e2f36);}" +
      ".translation-progress--embedded .translation-progress-body{display:block;max-height:min(40vh,360px);}" +
      ".translation-progress--embedded .translation-progress-btn," +
      ".translation-progress--embedded .translation-progress-chevron{display:none;}" +
      ".translation-progress--embedded.is-idle .translation-progress-track{display:none;}" +
      ".translation-progress--embedded.is-idle .translation-progress-body{border-top:0;}" +
      ".translation-progress-idle{color:#9aa0a6;padding:4px 2px;}" +
      ".translation-progress-start{margin-top:10px;padding:8px 14px;border:0;border-radius:8px;" +
      "background:var(--accent,#2563eb);color:#fff;font:13px/1.2 system-ui,sans-serif;cursor:pointer;}" +
      ".translation-progress-start:hover{filter:brightness(1.08);}" +
      ".translation-progress-host:empty{display:none;}" +
      "@keyframes uefn-tr-slide{0%{transform:translateX(-40%)}100%{transform:translateX(340%)}}" +
      "@keyframes uefn-tr-skel{0%{background-position:100% 0}100%{background-position:-100% 0}}";
    document.head.appendChild(style);
  }

  function idleBodyHtml() {
    return (
      '<div class="translation-progress-idle">' +
      "No translation in progress. Add a language, pick an API model (Anthropic / OpenAI / Gemini / Ollama — not Claude Code or Cursor), then press Start." +
      "</div>" +
      '<button type="button" class="translation-progress-start" data-translation-start>Start</button>'
    );
  }

  function progressMarkup(floating) {
    // Floating = toast chip only (no minimize / hide / chevron). Queue lives in Languages.
    return (
      '<div class="translation-progress-track"><div class="translation-progress-fill"></div></div>' +
      '<div class="translation-progress-panel">' +
      '<div class="translation-progress-chip">' +
      '<span class="translation-progress-chip-label"></span>' +
      "</div>" +
      (floating ? "" : '<div class="translation-progress-body"></div>') +
      "</div>"
    );
  }

  function clearFloatingProgress() {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  }

  function clearProgressUi(clearJobs) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    clearFloatingProgress();
    progressExpanded = false;
    overlayMinimized = false;
    if (clearJobs) jobItems = {};
    if (progressEmbedded) {
      progressEmbedded.className =
        "translation-progress translation-progress--embedded is-open is-idle";
      var body = progressEmbedded.querySelector(".translation-progress-body");
      var labelEl = progressEmbedded.querySelector(".translation-progress-chip-label");
      if (labelEl) labelEl.textContent = "Idle";
      if (body) {
        body.innerHTML = idleBodyHtml();
      }
    }
  }

  /** Always dismiss the floating toast after a short flash — never leave 129/129 stuck. */
  function scheduleProgressHide(ms) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hideTimer = null;
      clearFloatingProgress();
      progressExpanded = false;
      overlayMinimized = false;
      overlayHidden = false;
      if (lastProgress.state === "ok" || lastProgress.state === "error") {
        lastProgress = { state: "idle", message: "", lang: "", percent: null };
        clearJobItems();
        if (progressEmbedded) {
          progressEmbedded.className =
            "translation-progress translation-progress--embedded is-open is-idle";
          var body = progressEmbedded.querySelector(".translation-progress-body");
          var labelEl = progressEmbedded.querySelector(".translation-progress-chip-label");
          if (labelEl) labelEl.textContent = "Idle";
          if (body) {
            body.innerHTML = idleBodyHtml();
          }
        }
      }
    }, ms || 1400);
  }

  function categoryFor(src) {
    return CATEGORY_BY_STRING[src] || "Discovered";
  }

  function trackJob(src, status, value) {
    var key = String(src || "").trim();
    if (!key) return;
    var prev = jobItems[key] || { src: key, cat: categoryFor(key), status: "queued", value: "" };
    prev.status = status || prev.status;
    if (value != null) prev.value = value;
    jobItems[key] = prev;
  }

  function clearJobItems() {
    jobItems = {};
  }

  function jobStats() {
    var keys = Object.keys(jobItems);
    var done = 0;
    var active = 0;
    var err = 0;
    for (var i = 0; i < keys.length; i++) {
      var s = jobItems[keys[i]].status;
      if (s === "done") done++;
      else if (s === "active") active++;
      else if (s === "error") err++;
    }
    return { total: keys.length, done: done, active: active, err: err };
  }

  function buildJobListHtml() {
    var groups = {};
    var order = [];
    Object.keys(jobItems).forEach(function (k) {
      var it = jobItems[k];
      var cat = it.cat || "Other";
      if (!groups[cat]) {
        groups[cat] = [];
        order.push(cat);
      }
      groups[cat].push(it);
    });
    order.sort(function (a, b) {
      var rank = { Settings: 0, Chrome: 1, Editor: 2, Chat: 3, Discovered: 9 };
      return (rank[a] != null ? rank[a] : 5) - (rank[b] != null ? rank[b] : 5) || a.localeCompare(b);
    });
    var html = "";
    for (var g = 0; g < order.length; g++) {
      var cat = order[g];
      var items = groups[cat].slice().sort(function (a, b) {
        var rank = { active: 0, queued: 1, error: 2, done: 3 };
        return (rank[a.status] || 9) - (rank[b.status] || 9) || a.src.localeCompare(b.src);
      });
      var doneN = items.filter(function (x) { return x.status === "done"; }).length;
      html +=
        '<div class="translation-progress-cat">' +
        escapeHtml(cat) +
        " · " +
        doneN +
        "/" +
        items.length +
        "</div>";
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dst =
          it.status === "done"
            ? escapeHtml(it.value || "")
            : it.status === "active"
              ? "Translating…"
              : it.status === "error"
                ? "Failed — retrying…"
                : " ";
        html +=
          '<div class="translation-progress-row is-' +
          it.status +
          '"><span class="translation-progress-dot"></span><div>' +
          '<div class="translation-progress-src">' +
          escapeHtml(it.src) +
          "</div>" +
          '<div class="translation-progress-dst">' +
          dst +
          "</div></div></div>";
      }
    }
    return html || '<div class="translation-progress-cat">Waiting for strings…</div>';
  }

  function renderJobList() {
    var html = buildJobListHtml();
    [progressEl, progressEmbedded].forEach(function (root) {
      if (!root) return;
      var body = root.querySelector(".translation-progress-body");
      if (body) body.innerHTML = html;
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureProgressEl() {
    ensureProgressStyles();
    if (progressEl) return;
    progressEl = document.createElement("div");
    progressEl.className = "translation-progress";
    progressEl.setAttribute("data-no-translate", "");
    progressEl.setAttribute("role", "status");
    progressEl.innerHTML = progressMarkup(true);
    document.body.appendChild(progressEl);
  }

  function ensureEmbedded() {
    ensureProgressStyles();
    var hostEl = document.getElementById("uefn-translation-progress-host");
    if (!hostEl) {
      progressEmbedded = null;
      return;
    }
    if (progressEmbedded && hostEl.contains(progressEmbedded)) return;
    progressEmbedded = document.createElement("div");
    progressEmbedded.className =
      "translation-progress translation-progress--embedded is-open is-idle";
    progressEmbedded.setAttribute("data-no-translate", "");
    progressEmbedded.setAttribute("role", "status");
    progressEmbedded.innerHTML = progressMarkup(false);
    hostEl.innerHTML = "";
    hostEl.appendChild(progressEmbedded);
    var labelEl = progressEmbedded.querySelector(".translation-progress-chip-label");
    var body = progressEmbedded.querySelector(".translation-progress-body");
    if (labelEl) labelEl.textContent = "Idle";
    if (body) {
      body.innerHTML = idleBodyHtml();
    }
  }

  function watchProgressHost() {
    if (hostWatcher) return;
    ensureEmbedded();
    hostWatcher = new MutationObserver(function () {
      var hostEl = document.getElementById("uefn-translation-progress-host");
      if (!hostEl) {
        progressEmbedded = null;
        return;
      }
      if (!progressEmbedded || !hostEl.contains(progressEmbedded)) {
        ensureEmbedded();
        if (lastProgress.state && lastProgress.state !== "idle") {
          publishProgress(Object.assign({}, lastProgress, { force: true }));
        }
      }
    });
    hostWatcher.observe(document.body, { childList: true, subtree: true });
  }

  function paintProgressRoot(root, state, label, percent, embedded) {
    if (!root) return;
    root.classList.toggle("is-error", state === "error");
    root.classList.toggle("is-done", state === "ok");
    root.classList.toggle("is-idle", false);
    if (embedded) {
      root.classList.add("is-open");
      root.classList.remove("is-minimized", "is-overlay-hidden");
    } else {
      // Floating toast: chip only, never a sticky minimized bar.
      root.classList.remove("is-open", "is-minimized", "is-overlay-hidden");
    }
    var fill = root.querySelector(".translation-progress-fill");
    var labelEl = root.querySelector(".translation-progress-chip-label");
    if (fill) {
      if (state === "running" && percent == null) {
        fill.classList.add("is-indeterminate");
        fill.style.width = "";
      } else {
        fill.classList.remove("is-indeterminate");
        var w =
          state === "ok" || state === "error"
            ? 100
            : percent != null
              ? Math.max(percent, 4)
              : 8;
        fill.style.width = w + "%";
      }
    }
    if (labelEl) labelEl.textContent = label;
  }

  /**
   * Floating toast (auto-dismiss) + Languages tab embed (always).
   * After chromeReady, discovery stays quiet on floating; finished always flashes then goes away.
   */
  function publishProgress(partial) {
    var state = partial.state || "idle";
    var message = partial.message || "";
    var lang = partial.lang != null ? partial.lang : activeLang;
    var percent = typeof partial.percent === "number" ? Math.max(0, Math.min(100, partial.percent)) : null;

    watchProgressHost();
    ensureEmbedded();

    if (state === "idle") {
      clearProgressUi(true);
      return;
    }

    var stats = jobStats();
    // Queue fully drained while still "running" → treat as done so the toast never sticks at N/N.
    if (
      state === "running" &&
      stats.total > 0 &&
      stats.done >= stats.total &&
      !stats.active &&
      pending.size === 0
    ) {
      state = "ok";
      if (!message || message.indexOf("Translating") === 0) {
        message = "UI language: " + (lang || "");
      }
      percent = 100;
    }

    lastProgress = { state: state, message: message, lang: lang, percent: percent };

    var label =
      state === "error"
        ? message || "Translation error"
        : state === "ok"
          ? message || "UI language: " + (lang || "")
          : message || "Preparing…";
    if (state === "running" && stats.total) {
      label =
        "Translating " +
        (lang || "") +
        " · " +
        stats.done +
        "/" +
        stats.total +
        (stats.active ? " · batching…" : "");
      if (percent == null && stats.total) {
        percent = Math.round((stats.done / stats.total) * 100);
      }
    }

    // Languages tab — always live (background progress lives here)
    paintProgressRoot(progressEmbedded, state, label, percent, true);

    // Floating toast: show while running (seed) or when forced / finishing; never a sticky bar.
    var touchFloating =
      !!partial.force ||
      !chromeReady ||
      state === "ok" ||
      state === "error";
    if (touchFloating) {
      ensureProgressEl();
      paintProgressRoot(progressEl, state, label, percent, false);
    } else if (progressEl && state === "running") {
      // Discovery batches: keep Languages updated, leave floating alone (or clear if leftover).
      clearFloatingProgress();
    }

    renderJobList();

    if (state === "ok") scheduleProgressHide(1400);
    else if (state === "error") scheduleProgressHide(4000);
    else if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  // ── originals ──────────────────────────────────────────────────────
  function rememberText(node) {
    var existing = originalsText.get(node);
    var raw = node.nodeValue || "";
    if (existing === undefined) {
      var trimmed0 = raw.trim();
      // Never store a known translation as the English original.
      if (isKnownTranslationValue(trimmed0)) return raw;
      originalsText.set(node, raw);
      return raw;
    }
    var trimmed = raw.trim();
    var existingTr = catalog[existing.trim()];
    if (trimmed && trimmed !== existing.trim() && trimmed !== existingTr) {
      if (!isKnownTranslationValue(trimmed)) {
        originalsText.set(node, raw);
        return raw;
      }
    }
    return existing;
  }

  function rememberAttr(el, name) {
    var bag = originalsAttr.get(el) || {};
    if (bag[name] !== undefined) return bag[name];
    var raw = el.getAttribute(name) || "";
    if (isKnownTranslationValue(raw.trim())) {
      bag[name] = raw;
      originalsAttr.set(el, bag);
      return raw;
    }
    bag[name] = raw;
    originalsAttr.set(el, bag);
    return raw;
  }

  function attemptsOf(src) {
    return attemptCounts[src] || 0;
  }

  function bumpAttempt(src) {
    attemptCounts[src] = attemptsOf(src) + 1;
    return attemptCounts[src];
  }

  /** Give up: lock English so we never spend more tokens on this string. */
  function lockAsEnglish(src) {
    if (!src || src in catalog) return;
    catalog[src] = src;
    trackJob(src, "done", src);
    pending.delete(src);
  }

  function inChatTranslateRoot(node) {
    var el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return !!(el && el.closest && el.closest(".virtual-chat-message-list-root:not([data-no-translate])"));
  }

  function queuePending(trimmed, fromChat) {
    if (!seedReady) return;
    var key = normKey(trimmed);
    if (!key) return;
    if (catalogHas(key)) return;
    if (attemptsOf(key) >= MAX_ATTEMPTS_PER_STRING) return;
    var maxLen = fromChat ? MAX_CHAT_DISCOVER_LEN : MAX_DISCOVER_LEN;
    if (key.length > maxLen) return;
    if (pending.size >= MAX_PENDING && !pending.has(key)) return;
    if (llmCallsThisRun >= MAX_LLM_CALLS_PER_RUN) return;
    pending.add(key);
    trackJob(key, "queued", "");
  }

  function applyText(node, original) {
    var trimmed = normKey(original);
    if (!isTranslatableString(trimmed)) return;
    var translated = catalogGet(trimmed);
    if (!translated) {
      queuePending(trimmed, inChatTranslateRoot(node));
      return;
    }
    if (original === trimmed) {
      if (node.nodeValue !== translated) node.nodeValue = translated;
      return;
    }
    var lead = (original.match(/^\s*/) || [""])[0];
    var trail = (original.match(/\s*$/) || [""])[0];
    var next = lead + translated + trail;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function applyAttr(el, name, original) {
    var trimmed = normKey(original);
    if (!isTranslatableString(trimmed)) return;
    var translated = catalogGet(trimmed);
    if (!translated) {
      queuePending(trimmed);
      // Language on: never flash English native hover tooltips — show only once translated.
      if (name === "title" && el.getAttribute(name)) el.setAttribute(name, "");
      return;
    }
    if (el.getAttribute(name) !== translated) el.setAttribute(name, translated);
  }

  /**
   * Sync-apply catalog hits before the next paint. Hover cards / title tooltips
   * mount English from React — idle walker alone shows English then translates.
   */
  function applyKnownSync(root, budget) {
    if (!root || stopped || isEnglish(activeLang) || !seedReady) return;
    var left = budget == null ? 80 : budget;
    if (root.nodeType === Node.TEXT_NODE) {
      var tp = root.parentElement;
      if (tp && tp.tagName !== "INPUT" && tp.tagName !== "TEXTAREA" && !shouldSkipElement(tp)) {
        applyText(root, rememberText(root));
      }
      return;
    }
    function visit(el) {
      if (left <= 0 || !el || shouldSkipElement(el)) return;
      for (var i = 0; i < ATTRS.length && left > 0; i++) {
        var name = ATTRS[i];
        if (!el.hasAttribute(name)) continue;
        applyAttr(el, name, rememberAttr(el, name));
        left--;
      }
      var kids = el.childNodes;
      for (var c = 0; c < kids.length && left > 0; c++) {
        var n = kids[c];
        if (n.nodeType === Node.TEXT_NODE) {
          var p = n.parentElement;
          if (p && p.tagName !== "INPUT" && p.tagName !== "TEXTAREA" && !shouldSkipElement(p)) {
            applyText(n, rememberText(n));
            left--;
          }
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          visit(n);
        }
      }
    }
    if (root.nodeType === Node.ELEMENT_NODE) visit(root);
    else if (root.childNodes) {
      for (var i = 0; i < root.childNodes.length && left > 0; i++) {
        var ch = root.childNodes[i];
        if (ch.nodeType === Node.ELEMENT_NODE) visit(ch);
        else if (ch.nodeType === Node.TEXT_NODE) applyKnownSync(ch, 1);
      }
    }
  }

  // ── single walker ──────────────────────────────────────────────────
  function enqueueRoot(node) {
    if (!node || stopped || isEnglish(activeLang)) return;
    walkRoots.push(node);
    kickWalker();
  }

  function kickWalker() {
    if (walkBusy || stopped || isEnglish(activeLang)) return;
    if (!walkRoots.length) {
      if (walkOnIdle) {
        var cb = walkOnIdle;
        walkOnIdle = null;
        cb();
      }
      return;
    }
    walkBusy = true;
    var myGen = walkGen;
    var root = walkRoots.shift();
    var queue = [root];
    var attrI = 0;
    var attrNodes = null;
    var textWalker = null;

    function slice() {
      if (myGen !== walkGen || stopped || isEnglish(activeLang)) {
        walkBusy = false;
        walkRoots = [];
        return;
      }
      var t0 = performance.now();
      while (performance.now() - t0 < SLICE_MS) {
        if (textWalker) {
          var n = textWalker.nextNode();
          if (!n) {
            textWalker = null;
            continue;
          }
          applyText(n, rememberText(n));
          continue;
        }
        if (attrNodes) {
          if (attrI >= attrNodes.length) {
            attrNodes = null;
            attrI = 0;
            continue;
          }
          var child = attrNodes[attrI++];
          if (!shouldSkipElement(child)) {
            for (var a = 0; a < ATTRS.length; a++) {
              var an = ATTRS[a];
              if (!child.hasAttribute(an)) continue;
              applyAttr(child, an, rememberAttr(child, an));
            }
          }
          continue;
        }
        if (!queue.length) {
          walkBusy = false;
          kickWalker();
          return;
        }
        var node = queue.shift();
        if (!node) continue;
        if (node.nodeType === Node.TEXT_NODE) {
          var parent = node.parentElement;
          if (!shouldSkipElement(parent) && parent && parent.tagName !== "INPUT" && parent.tagName !== "TEXTAREA") {
            applyText(node, rememberText(node));
          }
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) continue;
        var el = node instanceof Element ? node : null;
        if (el && shouldSkipElement(el)) continue;
        if (el) {
          for (var i = 0; i < ATTRS.length; i++) {
            var name = ATTRS[i];
            if (!el.hasAttribute(name)) continue;
            applyAttr(el, name, rememberAttr(el, name));
          }
          textWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: function (tn) {
              var p = tn.parentElement;
              if (shouldSkipElement(p)) return NodeFilter.FILTER_REJECT;
              if (p && (p.tagName === "INPUT" || p.tagName === "TEXTAREA")) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          try {
            attrNodes = el.querySelectorAll(ATTRS.map(function (x) { return "[" + x + "]"; }).join(","));
          } catch (_) {
            attrNodes = [];
          }
          attrI = 0;
        } else if (node.childNodes && node.childNodes.length) {
          for (var c = 0; c < node.childNodes.length; c++) queue.push(node.childNodes[c]);
        }
      }
      scheduleSlice(slice);
    }
    scheduleSlice(slice);
  }

  /** Prefer idle callback so apply yields to input / agent UI paint. */
  function scheduleSlice(fn) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(function () { fn(); }, { timeout: 32 });
    } else {
      setTimeout(fn, 0);
    }
  }

  function cancelWalker() {
    walkGen += 1;
    walkBusy = false;
    walkRoots = [];
    // Must resolve applyCatalogToDom — dropping the callback freezes the pump forever.
    if (walkOnIdle) {
      var cb = walkOnIdle;
      walkOnIdle = null;
      try {
        cb();
      } catch (_) {}
    }
  }

  function applyCatalogToDom(myRun) {
    return new Promise(function (resolve) {
      if (!document.body || stopped || isEnglish(activeLang) || (myRun != null && myRun !== runId)) {
        resolve();
        return;
      }
      walkOnIdle = resolve;
      enqueueRoot(document.body);
    });
  }

  function buildReverseCatalog() {
    var reverse = {};
    Object.keys(catalog).forEach(function (k) {
      var v = catalog[k];
      if (typeof v === "string" && v && v !== k) reverse[v] = k;
    });
    return reverse;
  }

  /** Restore English: WeakMap originals + reverse catalog. Aborts if myRun is superseded. */
  function restoreIdle(myRun) {
    return new Promise(function (resolve) {
      if (!document.body) {
        resolve();
        return;
      }
      cancelWalker();
      var reverse = buildReverseCatalog();
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var attrList;
      try {
        attrList = document.body.querySelectorAll(ATTRS.map(function (a) { return "[" + a + "]"; }).join(","));
      } catch (_) {
        attrList = [];
      }
      var ai = 0;
      var phase = 0;
      function slice() {
        if (myRun != null && myRun !== runId) {
          resolve();
          return;
        }
        var t0 = performance.now();
        while (performance.now() - t0 < SLICE_MS) {
          if (myRun != null && myRun !== runId) {
            resolve();
            return;
          }
          if (phase === 0) {
            var n = walker.nextNode();
            if (!n) {
              phase = 1;
              continue;
            }
            var original = originalsText.get(n);
            if (original !== undefined) {
              if (n.nodeValue !== original) n.nodeValue = original;
              continue;
            }
            var cur = (n.nodeValue || "").trim();
            var eng = reverse[cur];
            if (eng) {
              var lead = ((n.nodeValue || "").match(/^\s*/) || [""])[0];
              var trail = ((n.nodeValue || "").match(/\s*$/) || [""])[0];
              n.nodeValue = lead + eng + trail;
            }
            continue;
          }
          if (ai >= attrList.length) {
            resolve();
            return;
          }
          var el = attrList[ai++];
          var bag = originalsAttr.get(el);
          for (var i = 0; i < ATTRS.length; i++) {
            var name = ATTRS[i];
            if (bag && bag[name] !== undefined) {
              var orig = bag[name];
              if (orig === "") el.removeAttribute(name);
              else if (el.getAttribute(name) !== orig) el.setAttribute(name, orig);
              continue;
            }
            if (!el.hasAttribute(name)) continue;
            var av = (el.getAttribute(name) || "").trim();
            var aEng = reverse[av];
            if (aEng) el.setAttribute(name, aEng);
          }
        }
        scheduleSlice(slice);
      }
      scheduleSlice(slice);
    });
  }

  function stripJsonFences(text) {
    var raw = String(text || "").trim();
    if (raw.indexOf("```") === 0) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
    }
    return raw.trim();
  }

  function parseCatalogResponse(text, batch) {
    var data = JSON.parse(stripJsonFences(text));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Translation response must be a JSON object");
    }
    var out = {};
    var missing = [];
    for (var i = 0; i < batch.length; i++) {
      var src = batch[i];
      var val = data[src];
      if (typeof val !== "string" || !val.trim()) {
        val = data[String(i)];
        if (val == null && i in data) val = data[i];
      }
      if (typeof val !== "string" || !val.trim()) {
        missing.push(src);
        continue;
      }
      out[src] = val;
    }
    if (!Object.keys(out).length) throw new Error("No translations in model response");
    if (missing.length > batch.length * 0.5) {
      throw new Error("Model missed too many keys (" + missing.length + "/" + batch.length + ")");
    }
    return { map: out, missing: missing };
  }

  function seedChrome(strings) {
    if (stopped || isEnglish(activeLang) || !strings || !strings.length) return;
    for (var i = 0; i < strings.length; i++) {
      var t = normKey(strings[i]);
      if (!isTranslatableString(t)) continue;
      if (catalogHas(t)) {
        trackJob(t, "done", catalogGet(t));
        continue;
      }
      pending.add(t);
      trackJob(t, "queued", "");
    }
  }

  function isBadBatchModel(model) {
    var raw = String(model || "").trim().toLowerCase();
    // Empty = Default Model, which is often Claude Code / Cursor — refuse before a loop.
    if (!raw) return true;
    var compact = raw.replace(/[\s_-]+/g, "");
    return (
      compact.indexOf("cursor") === 0 ||
      compact.indexOf("claudecode") === 0 ||
      compact.indexOf("codex") === 0
    );
  }

  function badModelMessage(model) {
    var shown = String(model || "").trim();
    return shown
      ? "Model " +
          shown +
          " can't batch-translate UI. Pick Anthropic / OpenAI / Gemini / Ollama in Languages → Model, then press Start."
      : "Pick an API model in Languages → Model (Anthropic / OpenAI / Gemini / Ollama). Default Model / Claude Code / Cursor / Codex cannot batch-translate UI.";
  }

  function isHardModelError(err) {
    var s = String(err || "").toLowerCase();
    return (
      s.indexOf("can't batch-translate") >= 0 ||
      s.indexOf("cannot batch-translate") >= 0 ||
      s.indexOf("needs an api model") >= 0 ||
      s.indexOf("hangs on batch") >= 0
    );
  }

  function hardStop(myRun, lang, message) {
    if (myRun != null && myRun !== runId) return;
    stopped = true;
    seedReady = false;
    chromeReady = false;
    disconnectObserver();
    pending.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    publishProgress({
      state: "error",
      lang: lang || activeLang,
      message: message,
      force: true,
    });
  }

  function armStartFromUi() {
    var prefs = readPrefs();
    var lang = typeof prefs.language === "string" ? prefs.language.trim() : "en";
    var model = typeof prefs.model === "string" ? prefs.model.trim() : "";
    if (isEnglish(lang)) {
      publishProgress({
        state: "error",
        message: "Pick a language first, then press Start.",
        force: true,
      });
      return;
    }
    if (isBadBatchModel(model)) {
      publishProgress({
        state: "error",
        lang: lang,
        message: badModelMessage(model),
        force: true,
      });
      return;
    }
    var h = host();
    if (h && h.prefs && typeof h.prefs.set === "function") {
      h.prefs.set({ translateStart: String(Date.now()) });
    }
  }

  function onDocClick(ev) {
    var t = ev && ev.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-translation-start]")) {
      ev.preventDefault();
      armStartFromUi();
    }
  }

  function isTimeoutError(err) {
    var s = String(err || "").toLowerCase();
    return s.indexOf("timed out") >= 0 || s.indexOf("timeout") >= 0;
  }

  /**
   * One MCP-backed translate batch. Never re-queues the same string forever —
   * that was burning ~hundreds of requests / millions of tokens on gemini-nano.
   */
  async function translateBatch(h, writeLang, writeModel, batch, myRun, splitDepth) {
    splitDepth = splitDepth || 0;
    if (llmCallsThisRun >= MAX_LLM_CALLS_PER_RUN) {
      for (var stop = 0; stop < batch.length; stop++) lockAsEnglish(batch[stop]);
      return { ok: true, count: 0, capped: true };
    }

    // Skip already-done / over-attempted keys before spending a call.
    var work = [];
    for (var w = 0; w < batch.length; w++) {
      var src = batch[w];
      if (src in catalog) continue;
      if (attemptsOf(src) >= MAX_ATTEMPTS_PER_STRING) {
        lockAsEnglish(src);
        continue;
      }
      work.push(src);
    }
    if (!work.length) return { ok: true, count: 0 };

    for (var b = 0; b < work.length; b++) {
      bumpAttempt(work[b]);
      trackJob(work[b], "active", "");
    }
    llmCallsThisRun += 1;
    publishProgress({
      state: "running",
      lang: writeLang,
      // Discovery batches (chat messages) must not re-open the floating UI panel.
      force: !chromeReady,
      message:
        "Translating " +
        writeLang +
        " · call " +
        llmCallsThisRun +
        "/" +
        MAX_LLM_CALLS_PER_RUN,
    });

    var payload = {};
    for (var j = 0; j < work.length; j++) payload[work[j]] = work[j];

    var res;
    try {
      if (h.translate && typeof h.translate.batch === "function") {
        res = await h.translate.batch({
          language: writeLang,
          strings: payload,
          model: writeModel,
        });
      } else if (h.llm && h.llm.batchComplete) {
        var user =
          "Target language: " +
          writeLang +
          "\nBatch size: " +
          work.length +
          "\n\nReturn ONLY JSON with the SAME keys; translate each value:\n" +
          JSON.stringify(payload);
        var raw = await h.llm.batchComplete({ system: SYSTEM, user: user, model: writeModel });
        if (raw && raw.ok) {
          var parsedLegacy = parseCatalogResponse(raw.text || "", work);
          res = { ok: true, map: parsedLegacy.map, missing: parsedLegacy.missing };
        } else {
          res = { ok: false, error: (raw && raw.error) || "Translation failed" };
        }
      } else {
        res = { ok: false, error: "Host translate API unavailable — update UEFN Ducky." };
      }
    } catch (e) {
      res = { ok: false, error: e && e.message ? e.message : "Translation failed" };
    }
    if (myRun !== runId || activeLang !== writeLang) return { ok: false, aborted: true };

    if (res && res.ok && res.map && typeof res.map === "object") {
      Object.keys(res.map).forEach(function (k) {
        if (typeof res.map[k] === "string" && res.map[k].trim()) {
          var nk = normKey(k);
          catalog[nk] = res.map[k];
          trackJob(nk, "done", res.map[k]);
          pending.delete(nk);
          pending.delete(k);
        }
      });
      var missing = Array.isArray(res.missing) ? res.missing : [];
      for (var m = 0; m < missing.length; m++) {
        var miss = missing[m];
        if (miss in catalog) continue;
        if (attemptsOf(miss) >= MAX_ATTEMPTS_PER_STRING) {
          lockAsEnglish(miss);
        } else {
          pending.add(miss);
          trackJob(miss, "queued", "");
        }
      }
      // Also lock any work item the model silently skipped (not in map, not in missing).
      for (var u = 0; u < work.length; u++) {
        if (!(work[u] in catalog) && attemptsOf(work[u]) >= MAX_ATTEMPTS_PER_STRING) {
          lockAsEnglish(work[u]);
        }
      }
      try {
        if (h.cache && h.cache.set) await h.cache.set(writeLang, catalog);
      } catch (_) {}
      // Do NOT full-DOM-apply after every batch (that + mutations burned requests).
      publishProgress({ state: "running", lang: writeLang, force: !chromeReady });
      return { ok: true, count: Object.keys(res.map).length };
    }

    var err = (res && res.error) || "Translation failed";
    // Timeout: split once only (depth 0 → 1). Deeper splits explode request count.
    if (work.length > 1 && splitDepth < 1 && isTimeoutError(err)) {
      var mid = Math.ceil(work.length / 2);
      var left = work.slice(0, mid);
      var right = work.slice(mid);
      for (var e = 0; e < work.length; e++) {
        // Undo the attempt bump so the split halves get a fair try — but still count the failed call.
        if (attemptCounts[work[e]]) attemptCounts[work[e]] -= 1;
        trackJob(work[e], "error", "");
      }
      publishProgress({
        state: "running",
        lang: writeLang,
        message: "Timed out — one smaller retry…",
        force: !chromeReady,
      });
      var a = await translateBatch(h, writeLang, writeModel, left, myRun, splitDepth + 1);
      if (myRun !== runId || activeLang !== writeLang) return { ok: false, aborted: true };
      var b2 = await translateBatch(h, writeLang, writeModel, right, myRun, splitDepth + 1);
      return { ok: !!(a.ok || b2.ok), count: (a.count || 0) + (b2.count || 0) };
    }

    for (var r = 0; r < work.length; r++) {
      if (work[r] in catalog) continue;
      if (attemptsOf(work[r]) >= MAX_ATTEMPTS_PER_STRING) {
        lockAsEnglish(work[r]);
      } else {
        pending.add(work[r]);
        trackJob(work[r], "error", "");
      }
    }
    return { ok: false, error: err, count: 0 };
  }

  /** Drain pending with skeleton progress. One flight at a time (via flushCatalog). */
  async function drainPending(myRun) {
    if (stopped || isEnglish(activeLang) || pending.size === 0 || myRun !== runId) return true;
    var h = host();
    if (!h || (!(h.translate && h.translate.batch) && !(h.llm && h.llm.batchComplete))) {
      publishProgress({
        state: "error",
        lang: activeLang,
        message: "Host translate API unavailable — update UEFN Ducky.",
      });
      return false;
    }
    var writeLang = activeLang;
    var writeModel = activeModel || "";
    var failStreak = 0;
    while (pending.size && !stopped && activeLang === writeLang && myRun === runId) {
      if (llmCallsThisRun >= MAX_LLM_CALLS_PER_RUN) {
        var leftover = Array.from(pending);
        for (var L = 0; L < leftover.length; L++) lockAsEnglish(leftover[L]);
        publishProgress({
          state: "running",
          lang: writeLang,
          message:
            "Stopped after " +
            MAX_LLM_CALLS_PER_RUN +
            " API calls (token guard). Cached strings still apply.",
          force: true,
        });
        break;
      }
      var all = Array.from(pending);
      var batch = all.slice(0, FLUSH_CHUNK);
      for (var i = 0; i < batch.length; i++) pending.delete(batch[i]);
      var result = await translateBatch(h, writeLang, writeModel, batch, myRun, 0);
      if (result.aborted || myRun !== runId || activeLang !== writeLang) return false;
      if (result.capped) break;
      if (result.ok) {
        failStreak = 0;
      } else {
        if (isHardModelError(result.error) || isBadBatchModel(writeModel)) {
          hardStop(myRun, writeLang, result.error || badModelMessage(writeModel));
          return false;
        }
        failStreak++;
        if (failStreak >= 3) {
          // Lock remaining pending so we don't spin.
          var rest = Array.from(pending);
          for (var x = 0; x < rest.length; x++) lockAsEnglish(rest[x]);
          publishProgress({
            state: "error",
            lang: writeLang,
            message: result.error || "Translation failed — check Settings → Languages for details.",
            force: true,
          });
          return false;
        }
      }
    }
    return myRun === runId;
  }

  /** Serialize flushes so discovery + seed never run two LLM drains at once. */
  function flushCatalog(myRun) {
    var result = flushTail.then(function () {
      return drainPending(myRun);
    });
    flushTail = result.then(
      function () {},
      function () {},
    );
    return result;
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () {
      flushTimer = null;
      if (!seedReady || !pending.size || stopped) return;
      if (llmCallsThisRun >= MAX_LLM_CALLS_PER_RUN) {
        // Token guard — discovery stays quiet for the rest of this language run.
        var drop = Array.from(pending);
        for (var d = 0; d < drop.length; d++) lockAsEnglish(drop[d]);
        return;
      }
      var myRun = runId;
      void flushCatalog(myRun).then(function (ok) {
        if (!ok || myRun !== runId || stopped) return;
        void applyCatalogToDom(myRun).then(function () {
          if (myRun !== runId || stopped) return;
          // Flash-done then dismiss — never leave a stale N/N toast after discovery.
          var n = Object.keys(catalog).length;
          publishProgress({
            state: "ok",
            lang: activeLang,
            message: n ? "UI language: " + activeLang + " (" + n + " cached)" : "UI language: " + activeLang,
            force: true,
          });
        });
      });
    }, 400);
  }

  function onMutations(mutations) {
    if (stopped || isEnglish(activeLang) || !seedReady) return;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === "characterData" && m.target && m.target.nodeType === Node.TEXT_NODE) {
        applyKnownSync(m.target, 4);
        enqueueRoot(m.target);
      } else if (m.type === "childList" && m.addedNodes && m.addedNodes.length) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE)) {
            // Hover portals / popovers: translate cached strings before paint.
            applyKnownSync(node, 120);
            enqueueRoot(node);
          }
        }
      } else if (m.type === "attributes" && m.target instanceof Element) {
        applyKnownSync(m.target, 8);
        enqueueRoot(m.target);
      }
    }
    if (mutateTimer) clearTimeout(mutateTimer);
    mutateTimer = setTimeout(function () {
      mutateTimer = null;
      if (pending.size) scheduleFlush();
    }, 80);
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function snapshotPriorValues() {
    priorValues = new Set();
    Object.keys(catalog).forEach(function (k) {
      var v = catalog[k];
      if (typeof v === "string" && v) priorValues.add(v);
    });
  }

  /**
   * Coalesce language requests to the latest only. Bumps runId so in-flight
   * restore/flush/apply abort instead of thrashing Spanish↔French↔German.
   */
  function requestLanguage(lang, model) {
    desiredLang = String(lang || "").trim() || "en";
    desiredModel = String(model || "").trim();
    runId += 1;
    cancelWalker();
    pending.clear();
    clearJobItems();
    llmCallsThisRun = 0;
    attemptCounts = {};
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (mutateTimer) {
      clearTimeout(mutateTimer);
      mutateTimer = null;
    }
    void pumpTransitions();
  }

  async function pumpTransitions() {
    if (pumpBusy) return;
    pumpBusy = true;
    var lastTicket = -1;
    try {
      while (true) {
        var lang = desiredLang;
        var model = desiredModel;
        var ticket = runId;
        lastTicket = ticket;
        try {
          await applyLanguage(lang, model, ticket);
        } catch (_) {}
        if (desiredLang === lang && desiredModel === model && runId === ticket) break;
      }
    } finally {
      pumpBusy = false;
    }
    if (runId !== lastTicket) void pumpTransitions();
  }

  /** Idle / English: restore then clear state. */
  async function goIdle(myRun) {
    chromeReady = false;
    seedReady = false;
    stopped = true;
    disconnectObserver();
    cancelWalker();
    pending.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (mutateTimer) {
      clearTimeout(mutateTimer);
      mutateTimer = null;
    }
    await restoreIdle(myRun);
    if (myRun !== runId) return;
    catalog = {};
    priorValues = new Set();
    originalsText = new WeakMap();
    originalsAttr = new WeakMap();
    skipCache = new WeakMap();
    activeLang = "";
    activeModel = "";
    publishProgress({ state: "idle" });
  }

  /**
   * Apply one language for a pump ticket. Restores English first; aborts when
   * a newer requestLanguage() bumps runId.
   *
   * Order: load cache → swap DOM immediately → download missing strings in the
   * background. Never wait on LLM before applying cached chrome.
   */
  async function applyLanguage(lang, model, myRun) {
    if (myRun !== runId) return;
    var next = String(lang || "").trim();
    var nextModel = String(model || "").trim();
    if (!next || isEnglish(next)) {
      await goIdle(myRun);
      return;
    }

    chromeReady = false;
    seedReady = false;
    stopped = false;
    cancelWalker();
    pending.clear();
    clearJobItems();
    llmCallsThisRun = 0;
    attemptCounts = {};
    skipCache = new WeakMap();

    // Always restore to English before applying a (possibly different) language.
    if (Object.keys(catalog).length || activeLang) {
      publishProgress({ state: "running", lang: next, message: "Switching language…", force: true });
      snapshotPriorValues();
      disconnectObserver();
      await restoreIdle(myRun);
      if (myRun !== runId) return;
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
      if (myRun !== runId) return;
    }

    activeLang = next;
    activeModel = nextModel;
    catalog = {};
    publishProgress({ state: "running", lang: next, message: "Preparing catalog…", force: true });

    var h = host();
    if (h && h.cache) {
      try {
        var data = await h.cache.get(next);
        if (myRun !== runId) return;
        if (data && typeof data === "object") {
          Object.keys(data).forEach(function (k) {
            if (typeof data[k] === "string") catalog[normKey(k)] = data[k];
          });
        }
      } catch (_) {}
    }
    if (myRun !== runId || stopped || activeLang !== next) return;

    if (isBadBatchModel(activeModel)) {
      hardStop(myRun, next, badModelMessage(activeModel));
      return;
    }

    // Skeleton queue for missing seed strings — do not block the swap on LLM.
    seedChrome(CORE_SEED);
    var nKeys = Object.keys(catalog).length;
    var hadCache = nKeys > 0;
    // Cold start: show floating toast. Cached swaps stay silent (Languages tab still updates).
    overlayHidden = false;
    overlayMinimized = false;
    progressExpanded = false;

    // SWAP FIRST — apply whatever cache we already have.
    seedReady = true;
    publishProgress({
      state: "running",
      lang: next,
      percent: hadCache ? Math.min(99, Math.round((nKeys / Math.max(nKeys + pending.size, 1)) * 100)) : 0,
      message: hadCache
        ? "UI language: " + next + " (" + nKeys + " cached)"
        : "Translating " + next,
      force: !hadCache,
    });
    await applyCatalogToDom(myRun);
    if (myRun !== runId || stopped) return;

    chromeReady = true;
    ensureObserver();

    if (!pending.size) {
      publishProgress({
        state: "ok",
        lang: next,
        message: nKeys ? "UI language: " + next + " (" + nKeys + " cached)" : "UI language: " + next,
        force: true,
      });
      return;
    }

    // Download missing phrases in the background; re-apply when the drain finishes.
    if (!hadCache) {
      publishProgress({
        state: "running",
        lang: next,
        message: "Translating " + next,
        force: true,
      });
    } else {
      publishProgress({ state: "running", lang: next, message: "Filling missing strings…" });
    }
    void flushCatalog(myRun).then(function (ok) {
      if (!ok || myRun !== runId || stopped) return;
      void applyCatalogToDom(myRun).then(function () {
        if (myRun !== runId || stopped) return;
        var n = Object.keys(catalog).length;
        publishProgress({
          state: "ok",
          lang: next,
          message: n ? "UI language: " + next + " (" + n + " cached)" : "UI language: " + next,
          force: true,
        });
      });
    });
  }

  function readPrefs() {
    var h = host();
    return (h && h.prefs && h.prefs.get()) || {};
  }

  function syncFromPrefs() {
    var prefs = readPrefs();
    var lang = typeof prefs.language === "string" ? prefs.language.trim() : "en";
    var model = typeof prefs.model === "string" ? prefs.model.trim() : "";
    desiredLang = lang;
    desiredModel = model;
    var token = String(prefs.translateStart || "");
    // First hydrate: remember leftover Start token, never treat it as a new press.
    if (lastStartToken === null) {
      lastStartToken = token;
      if (isEnglish(lang)) requestLanguage("en", model);
      return;
    }
    if (isEnglish(lang)) {
      requestLanguage("en", model);
      return;
    }
    if (token && token !== lastStartToken) {
      lastStartToken = token;
      requestLanguage(lang, model);
    }
  }

  function onPrefs(ev) {
    var detail = ev && ev.detail;
    if (detail && detail.pluginId && String(detail.pluginId).toLowerCase() !== PLUGIN_ID) return;
    syncFromPrefs();
  }

  function onTranslateScope(ev) {
    if (stopped || isEnglish(activeLang) || !seedReady) return;
    var sel = ev && ev.detail && ev.detail.selector;
    if (!sel || typeof sel !== "string") return;
    var nodes;
    try {
      nodes = document.querySelectorAll(sel);
    } catch (_) {
      return;
    }
    // Store / settings panels are dense — sync-apply a large budget then walk.
    var budget = sel.indexOf("store") >= 0 || sel.indexOf("settings") >= 0 ? 800 : 200;
    for (var i = 0; i < nodes.length; i++) {
      applyKnownSync(nodes[i], budget);
      enqueueRoot(nodes[i]);
    }
    if (pending.size) scheduleFlush();
  }

  window.addEventListener("uefn-plugin-prefs", onPrefs);
  window.addEventListener("uefn-translate-scope", onTranslateScope);
  document.addEventListener("click", onDocClick);
  window.__duckyPluginBootCleanups = window.__duckyPluginBootCleanups || {};
  // Disable / uninstall (keep-data or erase): always snap UI + pref back to English.
  // Language list + caches can stay; active language must not stick on a dead plugin.
  window.__duckyPluginBootCleanups[PLUGIN_ID] = function () {
    window.removeEventListener("uefn-plugin-prefs", onPrefs);
    window.removeEventListener("uefn-plugin-prefs-hydrated", onHydrated);
    window.removeEventListener("uefn-translate-scope", onTranslateScope);
    document.removeEventListener("click", onDocClick);
    var h = host();
    if (h && h.prefs && typeof h.prefs.set === "function") {
      try {
        h.prefs.set({ language: "en" });
      } catch (_) {}
    }
    requestLanguage("en", "");
  };

  async function boot() {
    watchProgressHost();
    var h = host();
    if (h && h.prefs && typeof h.prefs.hydrate === "function") {
      try {
        await h.prefs.hydrate();
      } catch (_) {}
    }
    syncFromPrefs();
  }

  function onHydrated() {
    syncFromPrefs();
  }
  window.addEventListener("uefn-plugin-prefs-hydrated", onHydrated);

  setTimeout(function () {
    void boot();
  }, 0);
})();
