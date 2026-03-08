from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import COPILOT_TOKEN_DIR, PROVIDER_STATE_PATH, ensure_runtime_directories, utc_timestamp


OPENAI_AUTH_PATH = Path.home() / ".codex" / "auth.json"
KILO_AUTH_PATH = Path.home() / ".local" / "share" / "kilo" / "auth.json"
KILO_BASE_URL = "https://api.kilo.ai/api/gateway"


@dataclass(frozen=True)
class ProviderDefinition:
    key: str
    label: str


@dataclass
class ProviderSelection:
    provider: str
    label: str
    validated_at: str
    credential_paths: list[str]

    def save(self) -> None:
        ensure_runtime_directories()
        PROVIDER_STATE_PATH.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")


PROVIDERS = (
    ProviderDefinition("openai", "OpenAI (Codex / GPT)"),
    ProviderDefinition("copilot", "Copilot"),
    ProviderDefinition("kilocode", "KiloCode"),
)


def load_selection() -> ProviderSelection | None:
    ensure_runtime_directories()
    if not PROVIDER_STATE_PATH.exists():
        return None
    data = json.loads(PROVIDER_STATE_PATH.read_text(encoding="utf-8"))
    return ProviderSelection(**data)


def choose_provider_interactively() -> ProviderDefinition:
    print("Select login provider:", flush=True)
    for index, provider in enumerate(PROVIDERS, start=1):
        print(f"  {index}. {provider.label}", flush=True)
    raw_choice = input("> ").strip()
    try:
        choice = int(raw_choice)
    except ValueError as exc:
        raise RuntimeError(f'Invalid provider choice "{raw_choice}".') from exc
    if choice < 1 or choice > len(PROVIDERS):
        raise RuntimeError(f"Provider choice out of range: {choice}")
    return PROVIDERS[choice - 1]


def run_interactive(command: list[str], env: dict[str, str] | None = None) -> None:
    completed = subprocess.run(command, env=env, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {completed.returncode}: {' '.join(command)}")


def post_json(url: str, payload: dict[str, object], headers: dict[str, str], timeout: int = 30) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str, headers: dict[str, str], timeout: int = 30) -> dict[str, object]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def load_openai_api_key() -> str:
    if not OPENAI_AUTH_PATH.exists():
        raise RuntimeError(f"OpenAI auth file not found at {OPENAI_AUTH_PATH}")
    auth = json.loads(OPENAI_AUTH_PATH.read_text(encoding="utf-8"))
    api_key = auth.get("OPENAI_API_KEY")
    if not isinstance(api_key, str) or not api_key:
        raise RuntimeError(f"OpenAI auth file at {OPENAI_AUTH_PATH} does not contain OPENAI_API_KEY")
    return api_key


def load_kilo_api_key() -> str:
    if not KILO_AUTH_PATH.exists():
        raise RuntimeError(f"Kilo auth file not found at {KILO_AUTH_PATH}")
    auth = json.loads(KILO_AUTH_PATH.read_text(encoding="utf-8"))
    kilo = auth.get("kilo")
    if not isinstance(kilo, dict):
        raise RuntimeError(f"Kilo auth file at {KILO_AUTH_PATH} does not contain the expected provider entry")
    api_key = kilo.get("key")
    if not isinstance(api_key, str) or not api_key:
        raise RuntimeError(f"Kilo auth file at {KILO_AUTH_PATH} does not contain an API key")
    return api_key


def validate_openai() -> None:
    api_key = load_openai_api_key()
    get_json("https://api.openai.com/v1/models", {"Authorization": f"Bearer {api_key}"})


def validate_kilo() -> None:
    api_key = load_kilo_api_key()
    post_json(
        f"{KILO_BASE_URL}/chat/completions",
        {
            "model": "openai/gpt-5-codex",
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 16,
        },
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )


def login_openai() -> ProviderSelection:
    try:
        validate_openai()
    except Exception:
        run_interactive(["codex", "login"])
        validate_openai()
    selection = ProviderSelection(
        provider="openai",
        label="OpenAI (Codex / GPT)",
        validated_at=utc_timestamp(),
        credential_paths=[str(OPENAI_AUTH_PATH)],
    )
    selection.save()
    return selection


def login_kilocode() -> ProviderSelection:
    try:
        validate_kilo()
    except Exception:
        run_interactive(["kilo", "auth", "login", "kilo"])
        validate_kilo()
    selection = ProviderSelection(
        provider="kilocode",
        label="KiloCode",
        validated_at=utc_timestamp(),
        credential_paths=[str(KILO_AUTH_PATH)],
    )
    selection.save()
    return selection


def _run_litellm_helper(script: str) -> None:
    command = ["uv", "run", "--with", "litellm", "python", "-c", script]
    env = os.environ.copy()
    env["GITHUB_COPILOT_TOKEN_DIR"] = str(COPILOT_TOKEN_DIR)
    run_interactive(command, env=env)


def login_copilot() -> ProviderSelection:
    ensure_runtime_directories()
    helper_script = """
import json
import os
import webbrowser
from litellm.llms.github_copilot.authenticator import Authenticator

auth = Authenticator()
try:
    token = auth.get_api_key()
    print(json.dumps({"status": "validated", "token_prefix": token[:6]}))
except Exception:
    device_code_info = auth._get_device_code()
    verification_uri = device_code_info["verification_uri"]
    user_code = device_code_info["user_code"]
    print(f"Opening browser for GitHub Copilot login: {verification_uri}", flush=True)
    webbrowser.open(verification_uri)
    print(f"Enter code: {user_code}", flush=True)
    access_token = auth._poll_for_access_token(device_code_info["device_code"])
    with open(auth.access_token_file, "w", encoding="utf-8") as handle:
        handle.write(access_token)
    api_info = auth._refresh_api_key()
    with open(auth.api_key_file, "w", encoding="utf-8") as handle:
        json.dump(api_info, handle)
    print(json.dumps({"status": "validated", "expires_at": api_info.get("expires_at")}))
"""
    _run_litellm_helper(helper_script)
    selection = ProviderSelection(
        provider="copilot",
        label="Copilot",
        validated_at=utc_timestamp(),
        credential_paths=[str(COPILOT_TOKEN_DIR)],
    )
    selection.save()
    return selection


def login(provider_key: str) -> ProviderSelection:
    if provider_key == "openai":
        return login_openai()
    if provider_key == "copilot":
        return login_copilot()
    if provider_key == "kilocode":
        return login_kilocode()
    raise RuntimeError(f"Unsupported provider: {provider_key}")


def login_selected_provider() -> ProviderSelection:
    provider = choose_provider_interactively()
    return login(provider.key)


def provider_runtime_env(selection: ProviderSelection) -> dict[str, str]:
    if selection.provider == "openai":
        return {
            "LLM_MODEL": "gpt-5-codex",
            "LLM_API_KEY": load_openai_api_key(),
        }
    if selection.provider == "kilocode":
        return {
            "LLM_MODEL": "openai/gpt-5-codex",
            "LLM_API_KEY": load_kilo_api_key(),
            "LLM_BASE_URL": KILO_BASE_URL,
            "LLM_CUSTOM_LLM_PROVIDER": "custom_openai",
        }
    if selection.provider == "copilot":
        return {
            "LLM_MODEL": "gpt-4.1",
            "LLM_CUSTOM_LLM_PROVIDER": "github_copilot",
            "GITHUB_COPILOT_TOKEN_DIR": str(COPILOT_TOKEN_DIR),
        }
    raise RuntimeError(f"Unsupported provider: {selection.provider}")
