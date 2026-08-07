# Multiplayer Guide

The game uses one relay process for both the website and WebSocket traffic. One player runs the relay; everyone opens that relay's URL and uses the same room code.

## Prepare the host

Install dependencies and build the current game:

```powershell
npm install
npm run build
npm run relay
```

The relay listens on port `8787` and prints:

```text
PVP DIMIR relay + game server on http://localhost:8787
```

Keep that terminal open for the whole session. Use `npm run relay`, not `npm run dev`, for multiplayer.

## Same network (LAN/Wi-Fi)

On the host PC, find its local IPv4 address:

```powershell
ipconfig
```

Look under the active Wi-Fi or Ethernet adapter for an address such as `192.168.1.42`.

If Windows asks about firewall access, allow Node.js on **Private networks**. If no prompt appears, the host can add a rule from an Administrator PowerShell window:

```powershell
netsh advfirewall firewall add rule name="PVP DIMIR" dir=in action=allow protocol=TCP localport=8787
```

Open the game as follows:

- Host: `http://localhost:8787`
- Other players: `http://HOST_IP:8787`, for example `http://192.168.1.42:8787`

All devices must be on the same non-isolated network. Guest Wi-Fi often blocks devices from contacting each other.

## Different networks (internet)

The simplest option is a Cloudflare Quick Tunnel. Install `cloudflared`, start the relay, then open another terminal on the host:

```powershell
cloudflared tunnel --url http://localhost:8787
```

Cloudflare prints a temporary HTTPS address similar to:

```text
https://example-name.trycloudflare.com
```

Share that HTTPS address with every player. Everyone, including the host, may open the same address. The game automatically uses the matching secure WebSocket endpoint at `/ws`.

The tunnel address changes whenever `cloudflared` restarts. Do not expose port `8787` directly on the router unless you understand port forwarding and firewall security.

## Start a match

1. Every player opens the same host or tunnel URL.
2. Select **Online**, or open **PvE** and choose **Swamprun**, **Expedition**, or
    **Mine Run**, or **Raid**. For a Raid, choose the target boss before setting
    up the party; the host's target and preparation mode apply to the room.
3. The first player selects **Host** and sets the player count to the number of human players.
4. Other players select **Join**.
5. Everyone enters the exact same room code and relay URL when prompted.
6. Keep every browser tab open until the match ends.

For a page served by `npm run relay`, accept the prefilled relay URL. When using the development server, manually entering another relay URL is possible but is not the recommended setup.

## Mode behavior

- **Online:** standard competitive multiplayer.
- **Swamprun:** cooperative survival. In Creative prep, each player configures their own stats and items; the game waits for every player and applies all setups identically on every client.
- **Expedition / Campaign:** cooperative campaign. Each player chooses upgrades, receives their own gold, buys their own items, can donate 1g at a time, and pays for their own rest. Two-player rewards are 80% per player, three-player rewards are 60%, and four-player rewards are 40%. The host controls continue/retreat decisions, recruitment, and departure.
- **Raid:** one cooperative fight against the host-selected Lich, Reaper, or
    Deathknight (Spear). Quick, Rolled stats + gear, and Creative preparation
    use the same synchronized setup flow as Swamprun. The fight opens with a
    shared preparation phase of harmless, endlessly reforming 1 HP effigies and
    three free restores (health and mind, mana, word charges) that cost no
    action; any player can end the phase from the action menu. Restores and the
    boss summon are relayed as ordinary turn commands, so every peer applies
    them together.
    Defeating the selected boss ends the match in victory, including when it has
    created extra units.
- **Mine Run:** cooperative maze exploration using Swamprun's preparation and
    shared gold. The complete discovered maze is shown during navigation; the
    party leader clicks one of the one-to-four highlighted routes connected to the
    current location. Tunnel, room-entry, treasure/ore, and shared-pickaxe choices
    are relayed as `mine-choice` before all clients apply the same seeded result.
    The map's Inventory button and `I` key open a read-only view of that client's
    local explorer; inspecting it sends no message and does not interrupt the
    leader's pending route choice.
    The party starts with one shared 2-durability pickaxe. Passage traps are
    predetermined when their routes are generated, shared by both directions,
    and consumed on their first crossing; active-light spotting and the resulting
    evasion roll are also seeded identically on every client.
    Room contents remain hidden until entry, except for an audible enemy warning.
    Hostile rooms start fresh combats only when entered, then return the party to
    the map when cleared. Entered rooms without ore or a shop are crossed without
    another prompt or relay choice. Supply rooms retain the normal synchronized
    per-player Swamprun shop flow. Room icons and vignettes reveal only entered
    room kinds. Held-weapon sprites, Earth Elemental pebble orbits, and Rockling
    shatter bursts are derived from synchronized state and consume no seeded RNG
    or additional network messages.

PvE maze passages, room contents, traps, mining rolls, enemy rosters, level rolls,
roles, equipment, AI choices, action rolls, hazards, and loot all use the shared
match seed. Every browser simulates them locally in the same order; only human
decisions travel through the relay. All players should run the same build so that
lockstep data and rules match.

## Troubleshooting

### Players cannot open the host URL

- Confirm the host relay terminal is still running.
- Confirm the other player used the host's LAN IPv4 address, not `localhost`.
- Confirm both devices are on the same network and not isolated guest Wi-Fi.
- Allow TCP port `8787` through the host firewall.

### Room never starts

- The host's **Players** value must equal the number of human browsers joining.
- Everyone must use the same room code.
- Refresh all clients and create a new room code after a disconnect during the lobby.

### Different-network connection fails

- Confirm both `npm run relay` and `cloudflared tunnel --url http://localhost:8787` are still running.
- Open the HTTPS tunnel URL in the browser; do not replace it with `ws://`.
- Corporate, school, or filtered networks may block WebSockets. Try another network or a phone hotspot.

### Port 8787 is already in use

Use another port in PowerShell:

```powershell
$env:PORT=9000
npm run relay
```

Then use `http://HOST_IP:9000` on LAN, or tunnel the new port:

```powershell
cloudflared tunnel --url http://localhost:9000
```
