"""Tests for openhands.providers."""
from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from openhands.config import RuntimePaths
from openhands.providers import (
    PROVIDERS,
    ProviderDefinition,
    ProviderSelection,
    choose_provider_interactively,
    get_json,
    load_kilo_api_key,
    load_openai_api_key,
    load_selection,
    login,
    login_selected_provider,
    post_json,
    provider_runtime_env,
    run_interactive,
    validate_kilo,
    validate_openai,
    _run_litellm_helper,
    login_openai,
    login_kilocode,
    login_copilot,
)


# ---------------------------------------------------------------------------
# ProviderDefinition
# ---------------------------------------------------------------------------


def test_provider_definition_fields() -> None:
    p = ProviderDefinition("openai", "OpenAI (Codex / GPT)")
    assert p.key == "openai"
    assert p.label == "OpenAI (Codex / GPT)"


def test_providers_tuple_has_three_entries() -> None:
    assert len(PROVIDERS) == 3
    keys = [p.key for p in PROVIDERS]
    assert "openai" in keys
    assert "copilot" in keys
    assert "kilocode" in keys


# ---------------------------------------------------------------------------
# ProviderSelection.save / load_selection
# ---------------------------------------------------------------------------


def test_provider_selection_save_and_load(patched_env: RuntimePaths) -> None:
    sel = ProviderSelection(
        provider="openai",
        label="OpenAI (Codex / GPT)",
        validated_at="2024-01-01T00:00:00Z",
        credential_paths=["/some/path"],
    )
    sel.save()
    loaded = load_selection()
    assert loaded is not None
    assert loaded.provider == "openai"
    assert loaded.label == "OpenAI (Codex / GPT)"
    assert loaded.credential_paths == ["/some/path"]


def test_load_selection_missing_returns_none(patched_env: RuntimePaths) -> None:
    assert load_selection() is None


# ---------------------------------------------------------------------------
# choose_provider_interactively
# ---------------------------------------------------------------------------


def test_choose_provider_valid_choice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "1")
    provider = choose_provider_interactively()
    assert provider.key == "openai"


def test_choose_provider_second_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "2")
    provider = choose_provider_interactively()
    assert provider.key == "copilot"


def test_choose_provider_third_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "3")
    provider = choose_provider_interactively()
    assert provider.key == "kilocode"


def test_choose_provider_invalid_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "abc")
    with pytest.raises(RuntimeError, match="Invalid provider choice"):
        choose_provider_interactively()


def test_choose_provider_out_of_range_low(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "0")
    with pytest.raises(RuntimeError, match="out of range"):
        choose_provider_interactively()


def test_choose_provider_out_of_range_high(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _: "99")
    with pytest.raises(RuntimeError, match="out of range"):
        choose_provider_interactively()


# ---------------------------------------------------------------------------
# run_interactive
# ---------------------------------------------------------------------------


def test_run_interactive_success(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_result = MagicMock()
    mock_result.returncode = 0
    monkeypatch.setattr("openhands.providers.subprocess.run", lambda *a, **kw: mock_result)
    run_interactive(["echo", "hello"])


def test_run_interactive_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_result = MagicMock()
    mock_result.returncode = 1
    monkeypatch.setattr("openhands.providers.subprocess.run", lambda *a, **kw: mock_result)
    with pytest.raises(RuntimeError, match="exit code 1"):
        run_interactive(["false"])


# ---------------------------------------------------------------------------
# get_json / post_json
# ---------------------------------------------------------------------------


def _make_url_response(data: dict) -> MagicMock:
    body = json.dumps(data).encode()
    resp = MagicMock()
    resp.read.return_value = body
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def test_get_json(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = _make_url_response({"models": []})
    monkeypatch.setattr("openhands.providers.urllib.request.urlopen", lambda *a, **kw: resp)
    result = get_json("https://example.com/api", {})
    assert result == {"models": []}


def test_post_json(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = _make_url_response({"id": "chatcmpl-42"})
    monkeypatch.setattr("openhands.providers.urllib.request.urlopen", lambda *a, **kw: resp)
    result = post_json("https://example.com/chat", {"messages": []}, {"Authorization": "Bearer x"})
    assert result == {"id": "chatcmpl-42"}


# ---------------------------------------------------------------------------
# load_openai_api_key
# ---------------------------------------------------------------------------


def test_load_openai_api_key_file_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", tmp_path / "no-file.json")
    with pytest.raises(RuntimeError, match="not found"):
        load_openai_api_key()


def test_load_openai_api_key_missing_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OTHER_KEY": "val"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        load_openai_api_key()


def test_load_openai_api_key_empty_string(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": ""}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        load_openai_api_key()


def test_load_openai_api_key_success(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-test-123"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    assert load_openai_api_key() == "sk-test-123"


# ---------------------------------------------------------------------------
# load_kilo_api_key
# ---------------------------------------------------------------------------


def test_load_kilo_api_key_file_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", tmp_path / "no.json")
    with pytest.raises(RuntimeError, match="not found"):
        load_kilo_api_key()


def test_load_kilo_api_key_missing_kilo_section(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    with pytest.raises(RuntimeError, match="expected provider entry"):
        load_kilo_api_key()


def test_load_kilo_api_key_kilo_not_dict(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": "not-a-dict"}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    with pytest.raises(RuntimeError, match="expected provider entry"):
        load_kilo_api_key()


def test_load_kilo_api_key_missing_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"other": "val"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    with pytest.raises(RuntimeError, match="API key"):
        load_kilo_api_key()


def test_load_kilo_api_key_success(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"key": "kilo-abc"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    assert load_kilo_api_key() == "kilo-abc"


# ---------------------------------------------------------------------------
# validate_openai / validate_kilo
# ---------------------------------------------------------------------------


def test_validate_openai_calls_get_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-test"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    resp = _make_url_response({"object": "list", "data": []})
    monkeypatch.setattr("openhands.providers.urllib.request.urlopen", lambda *a, **kw: resp)
    validate_openai()  # Must not raise.


def test_validate_kilo_calls_post_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"key": "kilo-key"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    resp = _make_url_response({"id": "resp"})
    monkeypatch.setattr("openhands.providers.urllib.request.urlopen", lambda *a, **kw: resp)
    validate_kilo()  # Must not raise.


# ---------------------------------------------------------------------------
# login_openai
# ---------------------------------------------------------------------------


def test_login_openai_validate_succeeds(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-test"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    monkeypatch.setattr("openhands.providers.validate_openai", lambda: None)
    sel = login_openai()
    assert sel.provider == "openai"


def test_login_openai_validate_fails_then_interactive(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-test"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    call_count = {"n": 0}

    def flaky_validate() -> None:
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("first call fails")

    monkeypatch.setattr("openhands.providers.validate_openai", flaky_validate)
    monkeypatch.setattr("openhands.providers.run_interactive", lambda *a, **kw: None)
    sel = login_openai()
    assert sel.provider == "openai"
    assert call_count["n"] == 2


# ---------------------------------------------------------------------------
# login_kilocode
# ---------------------------------------------------------------------------


def test_login_kilocode_validate_succeeds(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"key": "kilo-key"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    monkeypatch.setattr("openhands.providers.validate_kilo", lambda: None)
    sel = login_kilocode()
    assert sel.provider == "kilocode"


def test_login_kilocode_validate_fails_then_interactive(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"key": "kilo-key"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    call_count = {"n": 0}

    def flaky_validate() -> None:
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("first call fails")

    monkeypatch.setattr("openhands.providers.validate_kilo", flaky_validate)
    monkeypatch.setattr("openhands.providers.run_interactive", lambda *a, **kw: None)
    sel = login_kilocode()
    assert sel.provider == "kilocode"
    assert call_count["n"] == 2


# ---------------------------------------------------------------------------
# _run_litellm_helper
# ---------------------------------------------------------------------------


def test_run_litellm_helper_passes_env(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    def mock_run_interactive(command: list, env: dict | None = None) -> None:
        captured["command"] = command
        captured["env"] = env

    monkeypatch.setattr("openhands.providers.run_interactive", mock_run_interactive)
    _run_litellm_helper("print('hello')")
    assert "uv" in captured["command"]
    assert captured["env"] is not None
    assert "GITHUB_COPILOT_TOKEN_DIR" in captured["env"]


# ---------------------------------------------------------------------------
# login_copilot
# ---------------------------------------------------------------------------


def test_login_copilot(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("openhands.providers._run_litellm_helper", lambda s: None)
    sel = login_copilot()
    assert sel.provider == "copilot"


# ---------------------------------------------------------------------------
# login (routing)
# ---------------------------------------------------------------------------


def test_login_routes_openai(patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sel = ProviderSelection("openai", "OpenAI", "2024-01-01T00:00:00Z", [])
    monkeypatch.setattr("openhands.providers.login_openai", lambda: fake_sel)
    assert login("openai") is fake_sel


def test_login_routes_copilot(patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sel = ProviderSelection("copilot", "Copilot", "2024-01-01T00:00:00Z", [])
    monkeypatch.setattr("openhands.providers.login_copilot", lambda: fake_sel)
    assert login("copilot") is fake_sel


def test_login_routes_kilocode(patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_sel = ProviderSelection("kilocode", "KiloCode", "2024-01-01T00:00:00Z", [])
    monkeypatch.setattr("openhands.providers.login_kilocode", lambda: fake_sel)
    assert login("kilocode") is fake_sel


def test_login_unknown_provider_raises() -> None:
    with pytest.raises(RuntimeError, match="Unsupported provider"):
        login("unknown")


# ---------------------------------------------------------------------------
# login_selected_provider
# ---------------------------------------------------------------------------


def test_login_selected_provider(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_def = ProviderDefinition("openai", "OpenAI")
    fake_sel = ProviderSelection("openai", "OpenAI", "2024-01-01T00:00:00Z", [])
    monkeypatch.setattr("openhands.providers.choose_provider_interactively", lambda: fake_def)
    monkeypatch.setattr("openhands.providers.login", lambda key: fake_sel)
    result = login_selected_provider()
    assert result is fake_sel


# ---------------------------------------------------------------------------
# provider_runtime_env
# ---------------------------------------------------------------------------


def test_provider_runtime_env_openai(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-xyz"}))
    monkeypatch.setattr("openhands.providers.OPENAI_AUTH_PATH", auth)
    sel = ProviderSelection("openai", "OpenAI", "2024-01-01T00:00:00Z", [])
    env = provider_runtime_env(sel)
    assert env["LLM_MODEL"] == "gpt-5-codex"
    assert env["LLM_API_KEY"] == "sk-xyz"


def test_provider_runtime_env_kilocode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    auth = tmp_path / "kilo.json"
    auth.write_text(json.dumps({"kilo": {"key": "kk-abc"}}))
    monkeypatch.setattr("openhands.providers.KILO_AUTH_PATH", auth)
    sel = ProviderSelection("kilocode", "KiloCode", "2024-01-01T00:00:00Z", [])
    env = provider_runtime_env(sel)
    assert env["LLM_API_KEY"] == "kk-abc"
    assert "LLM_BASE_URL" in env


def test_provider_runtime_env_copilot(patched_env: RuntimePaths) -> None:
    sel = ProviderSelection("copilot", "Copilot", "2024-01-01T00:00:00Z", [])
    env = provider_runtime_env(sel)
    assert env["LLM_CUSTOM_LLM_PROVIDER"] == "github_copilot"
    assert "GITHUB_COPILOT_TOKEN_DIR" in env


def test_provider_runtime_env_unknown_raises() -> None:
    sel = ProviderSelection("unknown", "Unknown", "2024-01-01T00:00:00Z", [])
    with pytest.raises(RuntimeError, match="Unsupported provider"):
        provider_runtime_env(sel)
