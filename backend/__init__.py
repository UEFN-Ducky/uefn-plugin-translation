"""Translation UEFN desktop plugin — registers MCP translate tools when enabled.

UI chrome + shell.boot live in this package. Agents use ``translate_ui_batch``
(same pipeline as Settings → Languages).
"""

from __future__ import annotations


def register(api) -> None:
    """Import Translation MCP tools onto the shared FastMCP instance (idempotent)."""
    import backend.tools.integrations.translation_tools  # noqa: F401

    api.log("Translation MCP tools registered")
