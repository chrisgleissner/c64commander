#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
"""This host's own LAN address, for joining the Ultimates' multicast groups.

The capture tools join 239.0.1.64/65 on a named local interface. That address differs on every
machine that runs them, so it is looked up here instead of being written into each script.
"""

from __future__ import annotations

import socket

# RFC 5737 documentation address. connect() on a UDP socket only selects a route; it sends nothing.
ROUTE_PROBE_ADDRESS = "192.0.2.1"
ROUTE_PROBE_PORT = 9


def local_lan_address(probe_address: str = ROUTE_PROBE_ADDRESS, socket_factory=socket.socket) -> str:
    """Return the local IPv4 address the kernel would use to reach `probe_address`."""
    with socket_factory(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect((probe_address, ROUTE_PROBE_PORT))
        except OSError as error:
            raise RuntimeError(
                f"cannot pick a local interface: no IPv4 route to {probe_address} ({error}); "
                "pass --iface with this host's LAN address"
            ) from error
        address = sock.getsockname()[0]
    if address == "0.0.0.0":
        raise RuntimeError(
            f"cannot pick a local interface: the route to {probe_address} has no source address; "
            "pass --iface with this host's LAN address"
        )
    return address


def resolve_iface(requested: str | None) -> str:
    """Use the address given on the command line, or detect this host's LAN address."""
    return requested if requested else local_lan_address()
