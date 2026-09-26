"""The HIL capture tools must work on any host, not only the bench they were written on.

They used to default `--iface` (and one of them `--host`) to fixed addresses on one LAN, so on
any other machine a multicast join named an interface the host did not have.
"""

import re
import sys
from pathlib import Path

import pytest

HIL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIL_DIR))

from lan_iface import ROUTE_PROBE_ADDRESS, local_lan_address, resolve_iface  # noqa: E402

PRIVATE_IPV4 = re.compile(
    r"(?<![\d.])(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?![\d.])"
)


class FakeSocket:
    def __init__(self, source: str = "198.51.100.7", connect_error: OSError | None = None):
        self.source = source
        self.connect_error = connect_error
        self.connected_to = None
        self.sent = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def connect(self, address):
        if self.connect_error:
            raise self.connect_error
        self.connected_to = address

    def getsockname(self):
        return (self.source, 40000)

    def send(self, data):
        self.sent.append(data)

    sendto = send


def test_reports_the_source_address_of_the_route_without_sending_anything():
    fake = FakeSocket()

    assert local_lan_address(socket_factory=lambda *_: fake) == "198.51.100.7"
    assert fake.connected_to[0] == ROUTE_PROBE_ADDRESS
    assert fake.sent == []


def test_probes_a_documentation_address_rather_than_a_real_host():
    assert ROUTE_PROBE_ADDRESS.startswith("192.0.2.")


def test_finds_the_loopback_source_through_a_real_socket():
    assert local_lan_address(probe_address="127.0.0.1") == "127.0.0.1"


def test_explains_how_to_recover_when_there_is_no_route():
    fake = FakeSocket(connect_error=OSError(101, "Network is unreachable"))

    with pytest.raises(RuntimeError, match=r"no IPv4 route to 192\.0\.2\.1.*pass --iface"):
        local_lan_address(socket_factory=lambda *_: fake)


def test_refuses_an_unbound_source_address():
    fake = FakeSocket(source="0.0.0.0")

    with pytest.raises(RuntimeError, match="no source address"):
        local_lan_address(socket_factory=lambda *_: fake)


def test_an_explicit_iface_wins_over_detection(monkeypatch):
    monkeypatch.setattr("lan_iface.local_lan_address", lambda: pytest.fail("detection must not run"))

    assert resolve_iface("203.0.113.5") == "203.0.113.5"


def test_a_missing_iface_is_detected(monkeypatch):
    monkeypatch.setattr("lan_iface.local_lan_address", lambda: "203.0.113.9")

    assert resolve_iface(None) == "203.0.113.9"
    assert resolve_iface("") == "203.0.113.9"


@pytest.mark.parametrize(
    "script", sorted(p.name for p in HIL_DIR.iterdir() if p.suffix in {".py", ".mjs", ".ts", ".sh"}), ids=str
)
def test_no_hil_tool_bakes_in_a_private_lan_address(script):
    assert PRIVATE_IPV4.findall((HIL_DIR / script).read_text(encoding="utf-8")) == []
