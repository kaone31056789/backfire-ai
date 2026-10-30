"""AI provider abstraction.

LLMs are used ONLY for language tasks (reading proposals into structured claims,
plain-language summaries). They never produce numerical scientific results; all
numbers come from ``app.science``. Every LLM output is validated against a
Pydantic schema and anything that cannot be traced back to the source text is
flagged.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

from ..services import safe_http

T = TypeVar("T", bound=BaseModel)

PROVIDERS = {
    "deterministic": {"label": "Deterministic rule-based (no external AI)", "models": ["rules-v1"], "requires_key": False},
    "anthropic": {"label": "Anthropic Claude", "models": ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
                  "requires_key": True},
    "openai": {"label": "OpenAI", "models": ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"], "requires_key": True},
    "ollama": {"label": "Ollama (cloud API or local)", "models": ["gpt-oss:120b", "gpt-oss:20b", "qwen3-coder:480b", "deepseek-v3.1:671b", "llama3.1", "qwen2.5"],
               "requires_key": False, "free_model": True},
}


class ProviderError(Exception):
    pass


@dataclass
class Usage:
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


class LLMProvider:
    name = "base"
    model = ""

    def structured(self, system: str, user: str, schema: Type[T]) -> tuple[T, Usage]:  # pragma: no cover
        raise NotImplementedError

    @staticmethod
    def _parse(text: str, schema: Type[T]) -> T:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ProviderError("No JSON object in model response")
        try:
            return schema.model_validate(json.loads(m.group(0)))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ProviderError(f"Structured output failed validation: {exc}") from exc


class DeterministicProvider(LLMProvider):
    """Signals callers to use their rule-based implementation."""

    name = "deterministic"
    model = "rules-v1"

    def structured(self, system, user, schema):
        raise ProviderError("deterministic provider has no language model")


class MockProvider(LLMProvider):
    """Test double returning a fixed payload."""

    name = "mock"
    model = "mock-1"

    def __init__(self, payload: dict):
        self.payload = payload

    def structured(self, system, user, schema):
        return schema.model_validate(self.payload), Usage(self.name, self.model, len(user) // 4, 50)


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-sonnet-5-5"):
        self.api_key = api_key
        self.model = model

    def structured(self, system, user, schema):
        body = {
            "model": self.model,
            "max_tokens": 4000,
            "system": system + "\nRespond with a single JSON object matching this JSON schema:\n"
            + json.dumps(schema.model_json_schema()),
            "messages": [{"role": "user", "content": user}],
        }
        r = safe_http.request("POST", "https://api.anthropic.com/v1/messages", json=body, timeout=90,
                              headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01",
                                       "content-type": "application/json"})
        if r.status_code >= 400:
            raise ProviderError(f"Anthropic API error {r.status_code}: {r.text[:200]}")
        data = r.json()
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        u = data.get("usage", {})
        return self._parse(text, schema), Usage(self.name, self.model, u.get("input_tokens", 0), u.get("output_tokens", 0))


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str = "gpt-4.1-mini"):
        self.api_key = api_key
        self.model = model

    def structured(self, system, user, schema):
        body = {
            "model": self.model,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system + "\nReturn JSON matching: " + json.dumps(schema.model_json_schema())},
                {"role": "user", "content": user},
            ],
        }
        r = safe_http.request("POST", "https://api.openai.com/v1/chat/completions", json=body, timeout=90,
                              headers={"authorization": f"Bearer {self.api_key}", "content-type": "application/json"})
        if r.status_code >= 400:
            raise ProviderError(f"OpenAI API error {r.status_code}: {r.text[:200]}")
        data = r.json()
        text = data["choices"][0]["message"]["content"]
        u = data.get("usage", {})
        return self._parse(text, schema), Usage(self.name, self.model, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))


class OllamaProvider(LLMProvider):
    """Ollama chat API - Ollama Cloud (https://ollama.com, API key) or a local server (no key)."""

    name = "ollama"

    def __init__(self, api_key: str | None, model: str = "gpt-oss:120b", host: str = "cloud"):
        from ..core.config import get_settings

        self.api_key = api_key
        self.model = model
        self.base = "https://ollama.com" if host == "cloud" else get_settings().ollama_local_url.rstrip("/")
        self.timeout = 120

    def structured(self, system, user, schema):
        # Some hosted models ignore `format`, so the schema is also spelled out in the prompt,
        # and one repair round-trip is allowed when the reply does not validate.
        js = json.dumps(schema.model_json_schema(), separators=(",", ":"))
        messages = [
            {"role": "system", "content": f"{system}\n\nReply with ONE JSON object that validates against this JSON Schema. "
                                          f"Use exactly these property names, no extra keys, no prose:\n{js}"},
            {"role": "user", "content": user},
        ]
        tokens_in = tokens_out = 0
        for attempt in range(2):
            data = self._chat(messages, schema)
            tokens_in += data.get("prompt_eval_count", 0) or 0
            tokens_out += data.get("eval_count", 0) or 0
            text = (data.get("message") or {}).get("content", "")
            try:
                return self._parse(text, schema), Usage(self.name, self.model, tokens_in, tokens_out)
            except ProviderError as exc:
                if attempt:
                    raise
                messages += [{"role": "assistant", "content": text[:4000]},
                             {"role": "user", "content": f"That JSON is invalid: {str(exc)[:600]}\nReturn the corrected JSON object only, "
                                                         f"using exactly the schema's property names."}]
        raise ProviderError("unreachable")

    def _chat(self, messages, schema) -> dict:
        body = {"model": self.model, "stream": False, "format": schema.model_json_schema(), "options": {"temperature": 0.2},
                "messages": messages}
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        try:
            r = safe_http.request("POST", f"{self.base}/api/chat", json=body, timeout=self.timeout, headers=headers)
        except safe_http.BlockedRequest as exc:
            raise ProviderError(str(exc)) from exc
        except Exception as exc:  # connection refused etc.
            raise ProviderError(f"Ollama unreachable at {self.base}: {type(exc).__name__}") from exc
        if r.status_code >= 400:
            raise ProviderError(f"Ollama API error {r.status_code}: {r.text[:200]}")
        return r.json()


def build_provider(name: str, api_key: str | None, model: str | None, host: str | None = None) -> LLMProvider:
    if name == "ollama" and (api_key or host == "local"):
        return OllamaProvider(api_key, model or "gpt-oss:120b", host or "cloud")
    if name == "anthropic" and api_key:
        return AnthropicProvider(api_key, model or "claude-sonnet-5-5")
    if name == "openai" and api_key:
        return OpenAIProvider(api_key, model or "gpt-4.1-mini")
    return DeterministicProvider()
