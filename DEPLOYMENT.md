# Deploying to GCP (Compute Engine, free-tier VM)

This runs the bot and its own Postgres side-by-side via Docker Compose on a
single `e2-micro` VM. `e2-micro` is in GCP's Always Free tier in
`us-west1`, `us-central1`, and `us-east1` — normal usage for a bot this
size should cost $0/month. Running Postgres in a container instead of
Cloud SQL avoids Cloud SQL's ~$8-15/month minimum.

The bot only makes outbound connections (Discord gateway, Postgres is
container-to-container), so no inbound firewall rules are needed beyond
allowing SSH (GCP's default network allows this already).

## Mobile-friendly path (recommended if not at a desktop)

GCP Cloud Shell's browser terminal doesn't survive phone app-switching
well — backgrounding the tab tends to reset the session. To avoid that:

1. Use **Cloud Shell only once**, for the steps in this doc up through
   "Create the VM" — that's the only part that has to happen there.
2. From then on, connect with a dedicated SSH app (e.g. **Termius**,
   free, Android/iOS) instead of Cloud Shell's `gcloud compute ssh`.
   Real SSH clients reconnect cleanly across app-switches; a browser tab
   running a web terminal does not.
3. Run everything on the VM inside **tmux** (installed by the startup
   script below). If the SSH connection drops mid-command anyway —
   phone signal, OS killing the app, whatever — reattach with
   `tmux attach -t deploy` and the command is still running exactly
   where it was, including a `docker compose up --build` that takes a
   couple minutes on `e2-micro`'s modest CPU.

The steps below are written so each Cloud Shell/SSH block is a single
paste — no interactive editors, no multi-step typing.

## 0. One-time project setup (Cloud Shell)

```bash
gcloud config set project zenithar-bot
gcloud services enable compute.googleapis.com
```

## 1. Generate an SSH key in your SSH app (skip if using Cloud Shell only)

In Termius (or your SSH app of choice): Keychain → generate a new key
(ED25519 is fine) → copy the **public** key. You'll paste it into the
command below. Keep the app open so you can copy it in step 3.

## 2. Write the startup script (installs Docker + tmux on first boot)

In Cloud Shell, paste this whole block as one:

```bash
cat > startup.sh <<'EOF'
#!/bin/bash
set -e
apt-get update
apt-get install -y ca-certificates curl gnupg git tmux
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | tee /etc/apt/keyrings/docker.asc > /dev/null
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
EOF
```

## 3. Create the VM

If you generated an SSH key in step 1, add `--metadata=ssh-keys=...`
with your own username and the public key you copied (keep the
`username:` prefix, paste the key right after it, no line break):

```bash
gcloud compute instances create keizaal-bot \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --metadata-from-file=startup-script=startup.sh \
  --metadata=ssh-keys="keizaal:PASTE_YOUR_PUBLIC_KEY_HERE"
```

(Skip the last `--metadata=ssh-keys=...` line entirely if you're staying
in Cloud Shell instead of switching to an SSH app — `gcloud compute ssh`
handles its own key automatically.)

Then get the external IP (needed for step 4 if using an SSH app):

```bash
gcloud compute instances describe keizaal-bot --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Give it about 90 seconds after creation for the startup script to finish
installing Docker before connecting.

## 4. Connect

**Using an SSH app:** add a new host with the external IP from step 3,
username `keizaal` (or whatever you used), auth = the key from step 1.
Connect, then start a persistent session:

```bash
tmux attach -t deploy || tmux new -s deploy
```

Run that same command every time you reconnect — if `deploy` is already
running it reattaches to whatever was in progress; if not, it creates it.

**Using Cloud Shell instead:**

```bash
gcloud compute ssh keizaal-bot --zone=us-central1-a
tmux new -s deploy
```

All remaining commands run inside that `tmux` session on the VM.

## 5. Get the code onto the VM

You'll need a GitHub Personal Access Token (fine-grained, read-only,
scoped to `tbytnar/zenithar_bot`) since the repo is private —
generate one at https://github.com/settings/personal-access-tokens/new,
then substitute it directly into the command below (don't paste tokens
into chat with anyone, including an AI assistant):

```bash
git clone https://<YOUR_GITHUB_USERNAME>:<YOUR_PAT>@github.com/tbytnar/zenithar_bot.git
cd zenithar_bot
git checkout main
```

## 6. Configure secrets (one paste, no editor)

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

## 7. Bring it up

```bash
sudo docker compose up -d --build
```

This is the step most likely to outlast a flaky connection — that's
what `tmux` in step 4 is for. If you get disconnected, reconnect and run
`tmux attach -t deploy` again; the build keeps going in the background
either way.

The `db` service runs `schema.sql` automatically on first start (via
Postgres's `docker-entrypoint-initdb.d`). Check both containers are
healthy:

```bash
sudo docker compose ps
sudo docker compose logs -f bot
```

You should see `Logged in as <botname>#0000` in the bot logs (Ctrl-C to
stop following).

## 8. Register slash commands (one-time, and again whenever commands change)

```bash
sudo docker compose run --rm bot node src/deploy-commands.js
```

## 9. Confirm it's alive

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
needed, since Docker itself is enabled as a system service (step 2's
startup script).

## Backups (not automated yet)

The Postgres data lives in a named Docker volume (`pgdata`) on the VM's
persistent disk. If you want point-in-time recovery beyond "the VM's disk
still exists," consider a cron job running `pg_dump` to a GCS bucket —
not set up here, ask if you want it added.
