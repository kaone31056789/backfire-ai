"""Sandboxed PDF text extraction worker.

Run as a separate, isolated interpreter process (``python -I -m app.services.pdf_worker <path>``)
with a hard timeout, so malformed or hostile PDFs cannot hang or crash the API
process. Only text is extracted; embedded scripts, forms, attachments and links
are never executed or followed.
"""
from __future__ import annotations

import json
import sys

MAX_PAGES = 80
MAX_CHARS = 200_000


def main(path: str) -> None:
    from pypdf import PdfReader

    reader = PdfReader(path, strict=False)
    if reader.is_encrypted:
        print(json.dumps({"error": "Encrypted PDFs are not supported"}))
        return
    parts, pages = [], len(reader.pages)
    for i, page in enumerate(reader.pages[:MAX_PAGES]):
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            parts.append("")
        if sum(len(p) for p in parts) > MAX_CHARS:
            break
    text = "\n".join(parts)[:MAX_CHARS]
    print(json.dumps({"pages": pages, "text": text, "truncated": pages > MAX_PAGES or len(text) >= MAX_CHARS}))


if __name__ == "__main__":
    main(sys.argv[1])
