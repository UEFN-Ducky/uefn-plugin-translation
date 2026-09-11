"""Self-check: Title Case labels, progress, coalesce pump, small batches, walker."""
from __future__ import annotations

import re
from pathlib import Path

BOOT = Path(__file__).resolve().parents[1] / "ui" / "boot.js"
src = BOOT.read_text(encoding="utf-8")

m = re.search(r"var IDENTIFIER_LIKE = (/.*?/);", src)
assert m, "IDENTIFIER_LIKE not found in boot.js"
pat = m.group(1)
body = pat[1 : pat.rfind("/")]
rx = re.compile(body)

must_translate = ["Support", "Store", "General", "Languages", "Appearance", "Account", "Duckies", "Outline"]
must_skip = ["foo_bar", "maxPlayers", "playerSpawn"]
for s in must_translate:
    assert not rx.search(s), f"Title Case UI label wrongly looks like an id: {s!r} vs {pat}"
for s in must_skip:
    assert rx.search(s), f"code id should match IDENTIFIER_LIKE: {s!r}"

assert "requestLanguage" in src and "pumpTransitions" in src, "coalesce language pump missing"
assert "translation-progress-body" in src, "expandable skeleton panel missing"
assert "SEED_CATEGORIES" in src, "category skeleton missing"
assert "translateBatch" in src, "per-batch translate + timeout split missing"
assert "h.translate.batch" in src or "translate.batch" in src, "MCP-backed translate.batch path missing"
assert "MAX_LLM_CALLS_PER_RUN" in src, "token-guard call cap missing"
assert "MAX_ATTEMPTS_PER_STRING" in src, "per-string attempt cap missing"
assert "lockAsEnglish" in src, "give-up lock missing"
assert "var FLUSH_CHUNK = 12" in src, "FLUSH_CHUNK should be 12 (large batches time out)"
assert "left === 0" not in src and "left===0" not in src, (
    "publishProgress must not gate chip hide on left===0"
)
assert "walkToken += 1" not in src and "++walkToken" not in src, (
    "global walkToken++ removed — use single walker with enqueueRoot"
)
assert "chromeReady" in src, "chromeReady flag missing"
assert "SWAP FIRST" in src or "swap DOM immediately" in src, (
    "applyLanguage must swap cached UI before awaiting LLM flush"
)
assert "void flushCatalog(myRun)" in src, (
    "seed flush must run in background after swap (not await before applyCatalogToDom)"
)
assert "lastStartToken" in src and "translateStart" in src, "Start token gate missing — language prefs must not auto-run LLM"
assert "data-translation-start" in src, "embedded Start button missing"
assert "hardStop" in src and "isHardModelError" in src, "coding-agent hard-fail missing"
assert "uefn-translate-scope" in src, "chat Translate must walk message list via uefn-translate-scope"
assert "MAX_CHAT_DISCOVER_LEN" in src, "chat messages need a longer discover cap than chrome"
assert "thinking-block-body" in src, "skip thinking dumps when translating chat"
assert "force: !chromeReady" in src, "discovery batches must not force-open floating progress"
assert "translation-progress-min" not in src, "floating minimize button removed"
assert "Always dismiss the floating toast" in src, "finished translation must auto-dismiss floating toast"
assert "buildReverseCatalog" in src, "reverse catalog restore missing"
assert "scheduleSlice" in src and "requestIdleCallback" in src, "idle-yielding walker missing"
assert "applyKnownSync" in src, "sync catalog apply for hover mounts missing"
assert 'name === "title"' in src or "name === 'title'" in src, "title hover English-suppress missing"
assert 'el.closest(".ducky-tree")' not in src, (
    "ducky-tree must not be blanket-skipped — folders/Duckies should translate"
)
assert 'el.closest(".virtual-chat-message-list-root")' not in src, (
    "chat list skip is data-no-translate only (per-chat auto translate)"
)
assert "Translate chat" in src or "Auto translate" in src, "hover translate seed strings missing"
print("ok: Title Case + skeleton/coalesce/batch guards")
