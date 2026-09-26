#!/usr/bin/env python3
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
#
# Licensed under the GNU General Public License v3.0 or later.
# See <https://www.gnu.org/licenses/> for details.
"""Measure how an Ultimate connected over Ethernet and Wi-Fi at once answers on each address.

For every address of every device it records: REST reachability, the FTP banner and the address
the PASV (227) and EPSV replies advertise, Telnet reachability, the address an ident (UDP 64) reply
comes from, and, for devices with A/V streams,
the source address of the stream packets for each combination of request address and destination
(multicast group, unicast to this host, and unicast with wifi=true).

Addresses come from the command line (--device NAME=ADDR,ADDR) or from a subnet scan (--scan), and
are grouped by the unique_id each address reports, so nothing here is specific to one bench.

    python3 tools/hil/dual_homing_probe.py --scan <subnet>/24 --iface <this host's address> --json out.json
"""

from __future__ import annotations

import argparse
import concurrent.futures
import ftplib
import ipaddress
import json
import socket
import struct
import sys
import time
import urllib.request

REST_TIMEOUT_S = 2.0
STREAM_LISTEN_S = 2.0
MULTICAST = {"audio": ("239.0.1.65", 11001), "video": ("239.0.1.64", 11000)}
UNICAST_PORT = {"audio": 11701, "video": 11700}


def rest(addr: str, path: str, method: str = "GET", password: str = "") -> tuple[int, str]:
    req = urllib.request.Request(f"http://{addr}{path}", method=method)
    if password:
        req.add_header("X-Password", password)
    try:
        with urllib.request.urlopen(req, timeout=REST_TIMEOUT_S) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace")
    except OSError as err:
        return 0, str(err)


def device_info(addr: str, password: str) -> dict | None:
    status, body = rest(addr, "/v1/info", password=password)
    if status != 200:
        return None
    try:
        info = json.loads(body)
    except ValueError:
        return None
    return info if info.get("unique_id") else None


def scan(subnet: str, password: str) -> dict[str, dict]:
    hosts = [str(h) for h in ipaddress.ip_network(subnet, strict=False).hosts()]
    found: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        for addr, info in zip(hosts, pool.map(lambda a: device_info(a, password), hosts)):
            if info:
                found[addr] = info
    return found


def probe_ftp(addr: str, password: str) -> dict:
    result: dict = {}
    try:
        ftp = ftplib.FTP()
        result["banner"] = ftp.connect(addr, 21, timeout=REST_TIMEOUT_S).strip()
        result["login"] = ftp.login("user", password).strip()
        result["pasv_reply"] = ftp.sendcmd("PASV").strip()
        start, end = result["pasv_reply"].find("("), result["pasv_reply"].find(")")
        fields = result["pasv_reply"][start + 1 : end].split(",")
        result["pasv_advertised"] = ".".join(fields[:4])
        result["pasv_matches_control"] = result["pasv_advertised"] == addr
        try:
            result["epsv_reply"] = ftp.sendcmd("EPSV").strip()
        except ftplib.error_perm as err:
            result["epsv_reply"] = f"refused: {err}"
        ftp.quit()
    except (OSError, ftplib.Error) as err:
        result["error"] = str(err)
    return result


def probe_telnet(addr: str) -> dict:
    try:
        with socket.create_connection((addr, 23), timeout=REST_TIMEOUT_S) as sock:
            sock.settimeout(1.0)
            try:
                data = sock.recv(64)
            except socket.timeout:
                data = b""
            return {"connected": True, "first_bytes": len(data)}
    except OSError as err:
        return {"connected": False, "error": str(err)}


def probe_ident(addr: str) -> dict:
    """Send the ident `json` request to UDP 64 and record which address the reply came from."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(REST_TIMEOUT_S)
        sock.sendto(b"json", (addr, 64))
        try:
            data, (src, _) = sock.recvfrom(2048)
        except socket.timeout:
            return {"answered": False}
    try:
        unique_id = json.loads(data.decode("utf-8", "replace")).get("unique_id")
    except ValueError:
        unique_id = None
    return {"answered": True, "reply_from": src, "reply_from_request_address": src == addr, "unique_id": unique_id}


def listen(group: str | None, port: int, iface: str, seconds: float) -> dict[str, int]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))
    if group:
        sock.setsockopt(
            socket.IPPROTO_IP,
            socket.IP_ADD_MEMBERSHIP,
            struct.pack("4s4s", socket.inet_aton(group), socket.inet_aton(iface)),
        )
    sock.settimeout(0.25)
    counts: dict[str, int] = {}
    end = time.time() + seconds
    while time.time() < end:
        try:
            _, (src, _) = sock.recvfrom(2048)
            counts[src] = counts.get(src, 0) + 1
        except socket.timeout:
            pass
    sock.close()
    return counts


def probe_stream(request_addr: str, stream: str, destination: str, wifi: bool, listen_group, listen_port, iface, password):
    query = f"ip={destination}" + ("&wifi=true" if wifi else "")
    status, body = rest(request_addr, f"/v1/streams/{stream}:start?{query}", "PUT", password)
    senders = listen(listen_group, listen_port, iface, STREAM_LISTEN_S) if status == 200 else {}
    stop_status, _ = rest(request_addr, f"/v1/streams/{stream}:stop", "PUT", password)
    return {
        "request_address": request_addr,
        "stream": stream,
        "destination": destination,
        "wifi": wifi,
        "start_status": status,
        "start_errors": body.strip()[:200] if status != 200 else "",
        "stop_status": stop_status,
        "senders": senders,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scan", help="subnet to scan for Ultimates, in CIDR notation")
    parser.add_argument("--device", action="append", default=[], help="NAME=ADDR,ADDR (repeatable)")
    parser.add_argument("--iface", required=True, help="this host's address on the LAN (for multicast joins and unicast)")
    parser.add_argument("--password", default="", help="device network password, if set")
    parser.add_argument("--no-streams", action="store_true", help="skip the stream measurements")
    parser.add_argument("--json", help="write the full result as JSON here")
    args = parser.parse_args()

    addresses: dict[str, dict] = {}
    if args.scan:
        addresses.update(scan(args.scan, args.password))
    for spec in args.device:
        _, addrs = spec.split("=", 1)
        for addr in addrs.split(","):
            info = device_info(addr, args.password)
            if info:
                addresses[addr] = info
    devices: dict[str, dict] = {}
    for addr, info in sorted(addresses.items()):
        dev = devices.setdefault(info["unique_id"], {"product": info.get("product"), "hostname": info.get("hostname"),
                                                     "firmware": info.get("firmware_version"), "addresses": []})
        dev["addresses"].append(addr)

    report = {"iface": args.iface, "devices": []}
    for unique_id, dev in devices.items():
        entry = {"unique_id": unique_id, **dev, "per_address": [], "streams": []}
        for addr in dev["addresses"]:
            entry["per_address"].append({"address": addr, "rest": rest(addr, "/v1/info", password=args.password)[0],
                                         "ftp": probe_ftp(addr, args.password), "telnet": probe_telnet(addr),
                                         "ident": probe_ident(addr)})
        has_streams = rest(dev["addresses"][0], "/v1/streams/audio:stop", "PUT", args.password)[0] != 404
        entry["has_streams"] = has_streams
        if has_streams and not args.no_streams:
            for addr in dev["addresses"]:
                for stream in ("audio", "video"):
                    group, port = MULTICAST[stream]
                    entry["streams"].append(probe_stream(addr, stream, f"{group}:{port}", False, group, port, args.iface, args.password))
                    uport = UNICAST_PORT[stream]
                    entry["streams"].append(probe_stream(addr, stream, f"{args.iface}:{uport}", False, None, uport, args.iface, args.password))
                entry["streams"].append(probe_stream(addr, "audio", f"{args.iface}:{UNICAST_PORT['audio']}", True, None,
                                                     UNICAST_PORT["audio"], args.iface, args.password))
        report["devices"].append(entry)

    for entry in report["devices"]:
        print(f"== {entry['product']} {entry['unique_id']} fw {entry['firmware']} addresses {entry['addresses']}")
        for row in entry["per_address"]:
            ftp = row["ftp"]
            print(f"  {row['address']}: REST {row['rest']}  FTP PASV advertises {ftp.get('pasv_advertised', ftp.get('error'))}"
                  f"  EPSV {ftp.get('epsv_reply', '-')}  Telnet {'ok' if row['telnet']['connected'] else row['telnet'].get('error')}"
                  f"  ident reply from {row['ident'].get('reply_from', 'no answer')}")
        for s in entry["streams"]:
            print(f"  stream {s['stream']:5} via {s['request_address']:15} to {s['destination']:22} wifi={str(s['wifi']):5} "
                  f"start {s['start_status']} senders {s['senders']} {s['start_errors']}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
