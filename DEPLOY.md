# Skribble — VPS Deployment Guide

Draw-and-guess party game. SvelteKit (Svelte 5) + Node adapter + better-sqlite3.
Architecture is HTTP polling (no WebSockets), so it runs behind any reverse proxy unchanged.

## Requirements

| Item | Value |
|---|---|
| OS | Any Linux with Node 20+ (22 LTS recommended) |
| Node | >= 20 (better-sqlite3 uses prebuilt binaries; no compiler needed) |
| RAM | ~150 MB idle |
| Disk | ~200 MB app + SQLite growth (tiny) |
| Network | Outbound HTTPS to `www.wordiebox.com` (word API). Optional — falls back to built-in word list if unreachable. |
| Ports | App listens on `PORT` (default 3000). Only the reverse proxy needs a public port (80/443). |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `localhost` | **Set to `0.0.0.0`** if not behind a proxy binding, or keep `127.0.0.1` when proxied |
| `SKRIBBLE_DATA_DIR` | `./data` (cwd-relative) | Directory for `skribble.db`. **Must be persistent.** Use an absolute path. |
| `NODE_ENV` | — | Set `production` |

SQLite file lives at `$SKRIBBLE_DATA_DIR/skribble.db` (plus `-wal` / `-shm` sidecars). Rooms, players, and scores are all in this one file. Losing it = losing all games.

## Build & run

```bash
git clone <REPO_URL> /opt/skribble
cd /opt/skribble
npm ci
npm run build            # emits build/index.js (adapter-node)
mkdir -p /var/lib/skribble

# smoke test (Ctrl+C to stop)
PORT=3000 HOST=127.0.0.1 NODE_ENV=production \
SKRIBBLE_DATA_DIR=/var/lib/skribble node build
```

Expected: log line with the port; `curl -s http://127.0.0.1:3000/` returns HTML containing `SKRIBBLE`.

## Keep it running (systemd)

`/etc/systemd/system/skribble.service`:

```ini
[Unit]
Description=Skribble game
After=network.target

[Service]
Type=simple
User=skribble
WorkingDirectory=/opt/skribble
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=NODE_ENV=production
Environment=SKRIBBLE_DATA_DIR=/var/lib/skribble
ExecStart=/usr/bin/node build
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
useradd -r -s /usr/sbin/nologin skribble
chown -R skribble:skribble /var/lib/skribble
systemctl daemon-reload
systemctl enable --now skribble
systemctl status skribble        # should be active (running)
```

## Reverse proxy (nginx + TLS)

`/etc/nginx/sites-available/skribble`:

```nginx
server {
    server_name skribble.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/skribble /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d skribble.example.com   # TLS
```

## Verify deployment

Run from any machine with Node 18+ (uses global fetch):

```bash
node scripts/check.mjs https://skribble.example.com
# expected last line: "✅ all flow checks passed"
```

Quick manual checks:

```bash
# home page
curl -s https://skribble.example.com/ | grep -o SKRIBBLE

# create a room (expect {"code":"XXXX","playerId":1})
curl -s -X POST https://skribble.example.com/api/rooms \
  -H 'content-type: application/json' -d '{"name":"SmokeTest"}'
```

## Updating

```bash
cd /opt/skribble
git pull
npm ci
npm run build
systemctl restart skribble
```

Data survives updates (it lives in `/var/lib/skribble`, outside the app dir).

## Backup / restore

```bash
# backup (safe while running, WAL mode)
sudo -u skribble sqlite3 /var/lib/skribble/skribble.db ".backup '/var/backups/skribble-$(date +%F).db'"

# restore: stop service, replace file, start
systemctl stop skribble
cp skribble-2026-01-01.db /var/lib/skribble/skribble.db
chown skribble:skribble /var/lib/skribble/skribble.db
systemctl start skribble
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `systemctl status` shows crash loop | `journalctl -u skribble -n 50`; common cause: Node < 20 or bad `SKRIBBLE_DATA_DIR` permissions |
| `SQLITE_CANTOPEN` on boot | `chown -R skribble:skribble $SKRIBBLE_DATA_DIR`; path must exist |
| Words are always from the small built-in list | Outbound HTTPS to `www.wordiebox.com` blocked (fine — fallback is automatic). Check `curl -s 'https://www.wordiebox.com/api/words?country=indonesian&number=1'` from the server |
| 502 from nginx | App not listening: check `systemctl status skribble` and `ss -tlnp | grep 3000` |
| Game state resets | App is writing to `./data` inside the app dir — `SKRIBBLE_DATA_DIR` not set in the systemd unit |
| Realtime feels laggy | Normal poll rate is ~700 ms. Ensure no aggressive proxy caching (the API routes are dynamic; nginx default is fine) |

## Notes for automated agents

- Deploy order: build → systemd unit → nginx → certbot → run `scripts/check.mjs` against the public URL. Fail if the check script does not print `✅ all flow checks passed`.
- Never delete `/var/lib/skribble` during updates.
- The app is a single Node process; horizontal scaling is not supported (SQLite is local). One VPS, one process.
- Health endpoint: `GET /api/rooms/<ANY_CODE>` returns `404 {"error":"Room not found"}` when the app and DB are healthy — use it as a liveness probe.
