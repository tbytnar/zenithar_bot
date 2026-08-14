# Deploying to GCP (Compute Engine, free-tier VM)

This runs the bot and its own Postgres side-by-side via Docker Compose on a
single `e2-micro` VM. `e2-micro` is in GCP's Always Free tier in
`us-west1`, `us-central1`, and `us-east1` — normal usage for a bot this
size should cost $0/month. Running Postgres in a container instead of
Cloud SQL avoids Cloud SQL's ~$8-15/month minimum.

The bot only makes outbound connections (Discord gateway, Postgres is
container-to-container), so no inbound firewall rules are needed.

Run everything below from **GCP Cloud Shell** (https://shell.cloud.google.com) —
`gcloud` is already authenticated there against your account. Docker
install is baked into a VM startup script so there's no manual `apt`
typing over SSH, and `.env` is written with one heredoc paste instead of
an interactive editor — both chosen to keep this doable from a phone.

## 0. One-time project setup

```bash
gcloud config set project zenithar-bot
gcloud services enable compute.googleapis.com
```

## 1. Write the startup script (installs Docker on first boot)

Paste this whole block as one:

```bash
cat > startup.sh <<'EOF'
#!/bin/bash
set -e
apt-get update
apt-get install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | tee /etc/apt/keyrings/docker.asc > /dev/null
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
EOF
```

## 2. Create the VM

```bash
gcloud compute instances create keizaal-bot \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --metadata-from-file=startup-script=startup.sh
```

(`pd-standard` at 30GB and `e2-micro` in this region are the free-tier
eligible combination — don't bump the machine type or disk type/size
without checking current free-tier limits.)

Give it about 90 seconds after this returns for the startup script to
finish installing Docker before moving on.

## 3. SSH in

```bash
gcloud compute ssh keizaal-bot --zone=us-central1-a
```

All remaining commands run on the VM, inside that SSH session.

## 4. Get the code onto the VM

You'll need a GitHub Personal Access Token (fine-grained, read-only,
scoped to `tbytnar/zenithar_bot`) since the repo is private —
generate one at https://github.com/settings/personal-access-tokens/new
on your phone, then substitute it below:

```bash
git clone https://<YOUR_GITHUB_USERNAME>:<YOUR_PAT>@github.com/tbytnar/zenithar_bot.git
cd zenithar_bot
git checkout main
```

## 5. Configure secrets (one paste, no editor)

Fill in the placeholders below in a notes app first, then paste the
whole block at once:

```bash
cat > .env <<'EOF'
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id
DATABASE_URL=postgres://user:password@localhost:5432/keizaal_inventory
POSTGRES_PASSWORD=pick-a-strong-random-password
EOF
```

`DATABASE_URL` here is unused by Compose (only relevant if you ever run
the bot outside Docker) — leave it as-is. Get `DISCORD_TOKEN` /
`DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID` from your Discord application,
see README.md for where.

## 6. Bring it up

```bash
sudo docker compose up -d --build
```

The `db` service runs `schema.sql` automatically on first start (via
Postgres's `docker-entrypoint-initdb.d`). Check both containers are
healthy:

```bash
sudo docker compose ps
sudo docker compose logs -f bot
```

You should see `Logged in as <botname>#0000` in the bot logs (Ctrl-C to
stop following).

## 7. Register slash commands (one-time, and again whenever commands change)

```bash
sudo docker compose run --rm bot node src/deploy-commands.js
```

## 8. Confirm it's alive

In Discord, run `/payout for:` (or any command) and confirm autocomplete
and replies work.

## Updating after a code change

```bash
cd ~/zenithar_bot
git pull
sudo docker compose up -d --build
```

`restart: unless-stopped` on both services means the bot and DB also
survive VM reboots and crashes automatically — no extra systemd unit
needed, since Docker itself is enabled as a system service (step 1's
startup script).

## Backups (not automated yet)

The Postgres data lives in a named Docker volume (`pgdata`) on the VM's
persistent disk. If you want point-in-time recovery beyond "the VM's disk
still exists," consider a cron job running `pg_dump` to a GCS bucket —
not set up here, ask if you want it added.
