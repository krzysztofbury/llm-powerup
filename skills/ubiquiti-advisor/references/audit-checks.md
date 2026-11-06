# Audit Checks

Use the checks that match the approved scope. Each finding cites the
endpoint and field it came from. If a field is missing on this version, record
the check as not evaluated instead of passing or failing it.

## Devices and firmware

- Devices offline, disconnected, pending adoption, or with frequent restarts
  (low uptime compared with their peers).
- Firmware marked upgradable, and devices of one model on mixed versions.
- Controller version and whether automatic updates are enabled; recommend a
  maintenance window and a backup before upgrades, never run them.
- Device SSH enabled with password authentication.

## Networks and segmentation

- Untrusted devices (guests, IoT, cameras) sharing the main LAN.
- Guest or IoT networks without isolation or inter-VLAN blocking rules.
- Overlapping subnets, DHCP ranges colliding with fixed IPs, or very small
  pools for the number of clients seen.
- DNS servers handed out per network and whether they are intended.
- IGMP snooping and multicast settings when streaming or casting is in scope.

## Wireless

- Security mode: WPA3 or WPA2/WPA3 transition preferred; flag open SSIDs
  without a captive portal, WEP, or WPA/TKIP.
- Protected management frames (PMF) disabled where clients support it.
- Guest SSIDs bound to the guest network with client isolation.
- Too many SSIDs (each one adds beacon airtime).
- 2.4 GHz channel width above 20 MHz, or channels other than 1, 6 and 11.
- Channel and transmit-power settings that make neighbouring APs overlap;
  minimum data rates and band steering when roaming is a complaint.
- Clients with weak signal or low rates, counted per AP, not listed.

## Firewall, forwarding and exposure

- Port forwards: what is exposed, whether a source restriction exists, and
  whether a VPN would remove the need.
- UPnP enabled, especially on networks with untrusted devices.
- Allow rules with any source and any destination, rules shadowed by an
  earlier rule, disabled rules left in place, and unused groups.
- Management access (SSH, controller UI) reachable from guest or IoT networks.
- IDS/IPS and its mode, when the gateway supports it.

## Routing and WAN

- Static routes pointing at unreachable next hops.
- WAN health, latency and drops from `stat/health`; failover configuration
  when more than one uplink exists.

## Snapshot sections

When the user asks for network documentation, organize it as:

- Topology overview - device roles, models, firmware (identifiers redacted
  unless requested)
- Networks and VLANs - purpose, VLAN ID, subnet, DHCP, isolation
- Wireless - SSIDs, security, bands, VLAN binding
- Firewall - rules summary, groups, concerns
- Port forwarding - active forwards and their restrictions
- Routing - static routes
- WAN health - uplink type, speeds, DNS
- Clients - counts per network
- Recommendations - prioritized as in the SKILL.md output format

Save it only to a user-approved path outside any repository.
