# Read Endpoints

Paths are relative to `<UNIFI_URL><UNIFI_API_PREFIX>/api/s/<UNIFI_SITE>/`.
This is the script's default allowlist. The script sends GET only; `rest/*`
paths also accept writes with other methods, which are out of scope for this
skill. Narrow `UNIFI_ALLOWED_ENDPOINTS` to what a task needs.

Responses have the shape `{"meta": {"rc": "ok"}, "data": [...]}`. Field
names vary between Network versions; check a field exists before drawing a
conclusion from its absence.

## Controller and devices

| Endpoint | Contents | Sensitivity |
|---|---|---|
| `stat/sysinfo` | Controller version, hostname, timezone | Low |
| `stat/health` | Per-subsystem health (`wan`, `lan`, `wlan`, `vpn`), WAN IP, latency, speed test results | Medium: public IP |
| `stat/device` | Adopted gateways, switches and APs: model, firmware, upgradable flag, uptime, ports, radios, IP, MAC | Medium |

## Network configuration

| Endpoint | Contents | Sensitivity |
|---|---|---|
| `rest/networkconf` | Networks and VLANs: purpose, VLAN ID, subnet, DHCP range, DNS, isolation flags, WAN settings | Medium |
| `rest/wlanconf` | SSIDs: security mode, WPA version, PMF, band, VLAN binding, guest and client isolation | Medium; passphrases are stripped |
| `rest/setting` | Site settings: IDS/IPS, DPI, country, auto-upgrade, SSH, management, UPnP and others | Medium; secrets are stripped |

## Firewall and routing

| Endpoint | Contents | Sensitivity |
|---|---|---|
| `rest/firewallrule` | Legacy firewall rules per ruleset (WAN_IN, LAN_IN, GUEST_IN, ...) | High |
| `rest/firewallgroup` | Address and port groups used by rules | High |
| `rest/portforward` | Port forwards: source restriction, external port, destination | High |
| `rest/routing` | Static routes | Medium |

Newer Network versions with zone-based firewalls keep policies in other
endpoints; if `rest/firewallrule` is empty on such a version, say the policy
set was not read rather than reporting "no rules".

## Clients and traffic

| Endpoint | Contents | Sensitivity |
|---|---|---|
| `stat/sta` | Connected clients: network, signal, rates, IP, MAC, hostname | High: use `--redact` |
| `rest/user` | Known clients including offline ones, aliases, notes, fixed IPs | High: use `--redact` |
| `stat/dpi` | Traffic by application or category, when DPI is enabled | High: use `--redact` |

## Scan order for a full audit

1. `stat/sysinfo` - controller version, which decides field names.
2. `stat/health` - subsystem status and WAN uplink.
3. `stat/device` - device inventory, firmware and uptime.
4. `rest/networkconf` - networks, VLANs, DHCP and isolation.
5. `rest/wlanconf` - SSIDs, security and VLAN bindings.
6. `rest/firewallrule` and `rest/firewallgroup` - rules and groups.
7. `rest/portforward` - exposed services.
8. `rest/routing` - static routes.
9. `rest/setting` - IDS/IPS, DPI, UPnP, SSH and other site settings.
10. `stat/sta` with `--redact` - client counts per network.

Skip any step outside the approved scope and list it under Limits.
