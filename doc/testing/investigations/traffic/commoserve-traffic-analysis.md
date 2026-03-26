# C64U Traffic Interception and HTTP Extraction

## Scope

- Traffic captured on a privately owned LAN
- Device owned and controlled by the author
- No authentication bypassing performed
- Only publicly accessible endpoints analysed
- Intended for interoperability, testing, and research purposes

---

## 1. Network Topology

- C64U: 192.168.1.167
- Desktop (Kubuntu 24.04): 192.168.1.185
- Gateway: 192.168.1.1
- Interface: enp0s31f6

All interception performed from the Kubuntu machine via ARP spoofing (MITM).

---

## 2. Interception Commands (Exact)

### Enable forwarding

sudo sysctl -w net.ipv4.ip_forward=1

### ARP spoofing (two concurrent terminals)

Terminal A:

```bash
sudo arpspoof -i enp0s31f6 -t 192.168.1.167 192.168.1.1
```

Terminal B:

```bash
sudo arpspoof -i enp0s31f6 -t 192.168.1.1 192.168.1.167
```

### Capture traffic

```bash
sudo tcpdump -i enp0s31f6 -w c64u.pcap host 192.168.1.167
```

### Analysis

```bash
wireshark c64u.pcap
```

---

## 3. Wireshark Extraction Procedure (Deterministic)

1. Apply filter: `ip.addr == 192.168.1.167`

2. Identify HTTP packet (port 80)

3. Right-click packet: Follow → TCP Stream

4. Set: Show data as: Raw

5. Extract:
   - Request line
   - Headers
   - Response payload

6. Convert request to curl:
   - Preserve semantic headers only
   - Remove transport headers (Connection, Content-Length)

---

## 4. Captured HTTP Exchange (Cleaned, Full Fidelity)

### Request

```text
GET /leet/search/aql?query=%28category%3Aapps%29 HTTP/1.1
Accept-Encoding: identity Host: commoserve.files.commodore.net
User-Agent: Assembly Query Client-Id: Commodore
```

### Response

```text
HTTP/1.1 200 OK Content-Type: application/json

[{"name":"JollyDisk","id":"2555659515","category":40,"siteCategory":0,"siteRating":0.0,"year":0,"rating":0,"updated":"2025-12-18"},{"name":"GUI64","id":"2555659417","category":40,"siteCategory":0,"siteRating":0.0,"year":0,"rating":0,"updated":"2025-12-18"},{"name":"UltimateTerm","id":"2555659516","category":40,"siteCategory":0,"siteRating":0.0,"year":2023,"rating":0,"updated":"2025-12-18","released":"2023-01-01"},{"name":"Joyride","id":"2567969688","category":40,"siteCategory":0,"siteRating":0.0,"year":2024,"rating":0,"updated":"2025-12-18","released":"2024-01-01"},{"name":"CCGMS
Ultimate","id":"2555665468","category":40,"siteCategory":0,"siteRating":0.0,"year":2017,"rating":0,"updated":"2025-12-18","released":"2017-01-01"},{"name":"Anykey","id":"2567906031","category":40,"siteCategory":0,"siteRating":0.0,"year":2024,"rating":0,"updated":"2025-12-18","released":"2024-01-01"}]
```

---

## 5. Equivalent curl (Minimal Deterministic Form)

```bash
curl -v\
'http://commoserve.files.commodore.net/leet/search/aql?query=%28category%3Aapps%29'\
-H 'Accept-Encoding: identity'\
-H 'User-Agent: Assembly Query'\
-H 'Client-Id: Commodore'
```

---

## 6. Extended Query (No Results)

### Request

```text
GET
/leet/search/aql?query=%28name%3A%22name1%22%29%20%26%20%28group%3A%22group1%22%29%20%26%20%28handle%3A%22handle1%22%29%20%26%20%28event%3A%22event1%22%29%20%26%20%28category%3Aapps%29%20%26%20%28date%3A1986%29%20%26%20%28type%3Ad64%29%20%26%20%28sort%3Aname%29%20%26%20%28order%3Aasc%29
HTTP/1.1 Accept-Encoding: identity Host: commoserve.files.commodore.net
User-Agent: Assembly Query Client-Id: Commodore
```

### Response

```text
HTTP/1.1 200 OK Content-Type: application/json

\[\]
```

---

## 7. Observations

- Protocol: HTTP (unencrypted)
- Transfer: originally chunked, normalized for clarity
- Backend: Cloudflare (edge termination)
- Query language: AQL-like syntax encoded in URL
- Client identity: static header `Client-Id: Commodore`
- User-Agent is firmware-defined
