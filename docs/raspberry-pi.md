# Running the whole stack on the Raspberry Pi 4

The goal is to run everything on `zigbee-hub`, the Pi that already runs Mosquitto + Zigbee2MQTT, so the PC can be off.

## 0. Prerequisites (check these first)

- **64-bit OS.** `uname -m` must print `aarch64`. On `armv7l` (32-bit Raspberry Pi OS) the Python wheels (ctranslate2, onnxruntime, asyncpg) won't install, so reflash with Raspberry Pi OS Lite **64-bit**.
- **RAM.** On a 4 GB or 8 GB Pi this is comfortable. On 2 GB it's tight: whisper loads about 200–300 MB, plus postgres, redis, Z2M, and two Python services. Add swap (`sudo dphys-swapfile`, `CONF_SWAPSIZE=2048`) either way, because the frontend `npm run build` peaks high.
- **Storage: use a USB 3 SSD rather than the SD card** if you can (boot from it, or at least put the repo/`volumes/` on it). Postgres, redis snapshots and docker logs write constantly, and SD cards die from that. This is the biggest reliability factor.
- **Power:** use the official 5V/3A supply. Undervoltage causes random hangs (`vcgencmd get_throttled` should print `0x0`).

## 1. Install Docker on the Pi

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER     # log out/in afterwards
sudo systemctl enable docker      # start on boot; compose services use restart: unless-stopped
```

## 2. Confirm the MQTT broker accepts non-localhost connections

The containers reach the broker through the Docker bridge (`host.docker.internal` → `172.17.0.1`), not via localhost. On `zigbee-hub`, Mosquitto has `listener 1883 127.0.0.1` (anonymous, local only) and `listener 1884 0.0.0.0` (password auth). The containers must therefore use **1884 + `gateway_user`**, the same `MQTT_PORT`/`MQTT_USERNAME`/`MQTT_PASSWORD` the PC already uses. 1883 isn't reachable from inside Docker.

## 3. Get the code + secrets onto the Pi

```sh
git clone <repo> ~/smart-home-os && cd ~/smart-home-os
```

Copy these from the PC. They are git-ignored, so `scp` them over Tailscale:
- `.env`: copy it **as-is**, then edit only the two lines below. **Keep `JWT_SECRET_KEY` identical**, because it's the key for every encrypted secret in the DB (Spotify tokens, API keys).
  ```
  TLS_HOST=zigbee-hub.tail1752d3.ts.net
  MQTT_HOST=host.docker.internal
  ```
- `certs/`: or generate fresh ones on the Pi (next step).

## 4. TLS cert (and renewal)

```sh
sudo tailscale cert --cert-file certs/zigbee-hub.tail1752d3.ts.net.crt \
                    --key-file  certs/zigbee-hub.tail1752d3.ts.net.key \
                    zigbee-hub.tail1752d3.ts.net
sudo chown $USER certs/*
```

Tailscale certs last **90 days**. Add a monthly root cron job (`sudo crontab -e`) that renews the cert and restarts the gateway:

```
0 4 1 * * cd /home/<user>/smart-home-os && tailscale cert --cert-file certs/zigbee-hub.tail1752d3.ts.net.crt --key-file certs/zigbee-hub.tail1752d3.ts.net.key zigbee-hub.tail1752d3.ts.net && docker restart home_gateway
```

## 5. Move the database (dump/restore, don't copy `volumes/`)

The postgres data dir isn't guaranteed portable from x86_64 to arm64, so use a logical dump. You don't need Redis: the twin rebuilds itself from retained MQTT messages.

On the **PC** (PowerShell; use `-f` rather than `>`, because PowerShell redirection corrupts binary output):
```powershell
docker exec home_postgres pg_dump -U <DB_USER> -Fc -f /tmp/home_os.dump home_os
docker cp home_postgres:/tmp/home_os.dump .\home_os.dump
scp .\home_os.dump <user>@zigbee-hub:~/smart-home-os/
```

On the **Pi**:
```sh
docker compose up -d postgres            # creates an empty home_os
docker cp home_os.dump home_postgres:/tmp/
docker exec home_postgres pg_restore -U <DB_USER> -d home_os --no-owner /tmp/home_os.dump
docker exec home_postgres psql -U <DB_USER> -d home_os -c "select * from alembic_version"   # expect the current head
```

The dump includes `alembic_version`, so don't run migrations afterwards (`alembic current` should just report the head).

## 6. Build and start

```sh
docker compose up -d --build     # first build on a Pi 4 is slow (~10–20 min): npm ci + vite build + uv sync
docker compose ps
docker compose logs -f gateway   # look for MQTT connected + bridge/devices received
```

Then open `https://zigbee-hub.tail1752d3.ts.net:8000` and log in with your existing account.

**Stop the stack on the PC** (`docker compose down`) before or right after this. Two gateways on the same broker both work, but agents/UIs would be split across two databases.

## 7. Things that change with the host

- **Spotify:** the redirect URI points at the host. Register `https://zigbee-hub.tail1752d3.ts.net:8000/...` (same path as today) in the Spotify developer app and update `SPOTIFY_REDIRECT_URI` in the Pi's `.env`.
- **Bookmarks / phone home-screen shortcut:** the URL changes from `awapc...` to `zigbee-hub...`.
- Whisper's `tiny.en` model is downloaded on first voice request (needs internet once). Expect a few seconds of transcription per utterance on the Pi's CPU.

## 8. Updating later

```sh
cd ~/smart-home-os && git pull && docker compose up -d --build gateway agent
```

To avoid slow builds on the Pi you can cross-build on the PC with `docker buildx build --platform linux/arm64 ...` and push to a registry, but building on the Pi is simpler and fine for a solo project.

## 9. Backups

- **Pi, 03:00 nightly:** `/usr/local/bin/smarthome-backup.sh` (root cron) writes `~/backups/smarthome-YYYY-MM-DD.tar.gz` and keeps 14 days. Its log is `/var/log/smarthome-backup.log`. Each bundle contains `smarthome/home_os.dump` + `.env`, `zigbee2mqtt/` (data dir, no logs), `mosquitto/`, and `pihole/` (Teleporter zip).
- **PC, at logon + 09:00:** the Task Scheduler task "SmartHome Backup Pull" runs `C:\Users\adams\Backups\smart-home-os\pull-backups.ps1`, which copies new bundles and keeps 30 days. It logs to `pull.log` in the same folder.
- **Docker cleanup, Sundays 03:30:** `/usr/local/bin/docker-prune.sh` removes dangling images and build cache unused for 7+ days. Its log is `/var/log/docker-prune.log`.
- **Cert, 04:00 on the 1st:** `/usr/local/bin/renew-tailscale-cert.sh` restarts the gateway only if the cert changed. Its log is `/var/log/tailscale-cert-renew.log`.

## 10. Restore after a dead SD card

1. Flash Raspberry Pi OS Lite **64-bit**, hostname `zigbee-hub`, user `adams`, and enable SSH. Install Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`). Remove the old `zigbee-hub` machine in the Tailscale admin first, so the name doesn't become `zigbee-hub-1`.
2. Copy the newest bundle from `C:\Users\adams\Backups\smart-home-os\` to the Pi and unpack it: `mkdir ~/restore && tar -xzf smarthome-*.tar.gz -C ~/restore`.
3. **Mosquitto:** `sudo apt install mosquitto`, `sudo cp -a ~/restore/mosquitto/. /etc/mosquitto/`, `sudo systemctl restart mosquitto`.
4. **Zigbee2MQTT:** install it per its docs (Node.js, clone into `/home/zigbee2mqtt/zigbee2mqtt`, systemd unit). **Before first start**, copy `~/restore/zigbee2mqtt/.` into its `data/` dir and `chown -R zigbee2mqtt:` it. Same coordinator stick means no re-pairing.
5. **Pi-hole:** install it (`curl -sSL https://install.pi-hole.net | bash`), then import with `sudo pihole-FTL --teleporter ~/restore/pihole/*.zip`.
6. **Stack:** run sections 1, 3, 4 and 6 above: Docker, clone, cert. Use `cp ~/restore/smarthome/.env ~/smart-home-os/.env` instead of copying from the PC. Before `up --build`, restore the DB as in section 5, with `~/restore/smarthome/home_os.dump` as the dump file.
7. Re-create the cron jobs. The scripts are kept in the repo under [deploy/pi/](../deploy/pi/): `sudo install -m 755 deploy/pi/*.sh /usr/local/bin/`, then run `sudo crontab -e`:
   ```
   0 4 1 * * /usr/local/bin/renew-tailscale-cert.sh
   0 3 * * * /usr/local/bin/smarthome-backup.sh
   30 3 * * 0 /usr/local/bin/docker-prune.sh
   ```
8. Optional: add `cgroup_enable=memory` to `/boot/firmware/cmdline.txt` so the agent's 1G limit is enforced.
9. Optional, the Spotify speaker (see section 11): it isn't in the backup bundle. Recreate `/etc/soloist/api_key` and `~/soloist`, then re-pair.

## 11. Spotify speaker ("Bedroom Speakers")

Spotify Soloist, Spotify's official headless Connect client, plays to the 3.5mm jack, which is cabled to the bedroom speakers. It's independent of this repo and of the app's compose stack:

- **Files:** `~/soloist` on the Pi (a compose project named `soloist`). Its `README.md` covers start, logs, re-pairing and rebuilding.
- **API key:** `/etc/soloist/api_key` (root, 0600), from the Spotify for Developers dashboard.
- **State:** the docker volume `soloist_soloist_data` holds the binary, the saved Spotify session and the cache.
- **Updates:** each Soloist build expires after 90 days. The container restarts and downloads the new build on its own.
- **Why a container:** Soloist needs glibc 2.38, and Debian 12 has 2.36. The image is Debian 13, about 100 MB. It uses about 35 MB of RAM and about 8% of one core while playing.
- **Audio:** the ALSA `PCM` control is pinned at 0 dB (`alsactl store`). Use Spotify's volume.
- **App side:** nothing to configure. The device stays in `/me/player/devices` while idle, so the agent can start it by name ("Bedroom Speakers") with no phone or PC open.
