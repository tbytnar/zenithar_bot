# Deploying to AWS (EC2, free-tier instance)

This runs the bot and its own Postgres side-by-side via Docker Compose on
a single EC2 instance. `t2.micro`/`t3.micro` are in AWS's 12-month Free
Tier (750 instance-hours/month — enough to run continuously). Running
Postgres in a container instead of RDS avoids RDS's ~$15+/month minimum
even on its smallest tier.

The bot only makes outbound connections (Discord gateway, Postgres is
container-to-container) — the default security group AWS creates for a
quick-launch instance (SSH on port 22 inbound, everything outbound)
is all that's needed. No other inbound rules required.

## Provisioning (for reference / re-creating)

- AMI: Amazon Linux 2023
- Instance type: `t2.micro` or `t3.micro` (free-tier eligible)
- Key pair: created/downloaded through the EC2 console, or connect via
  EC2 Instance Connect
- Security group: default (SSH inbound only) is sufficient

## Mobile-friendly connection notes

Once connected over SSH (via a real SSH app like ConnectBot, not a
browser-based console — those don't survive phone app-switching well),
start a persistent session immediately:

```bash
tmux new -s deploy
```

Run everything below inside that session. If the connection drops mid
command (phone signal, OS backgrounding the app, whatever), reconnect
and run:

```bash
tmux attach -t deploy
```

and whatever was running — including a slow `docker compose build` — is
still going, exactly where it left off.

## 1. Install Docker, Compose, git, tmux

Amazon Linux 2023 ships Docker in its own repo but not the Compose
plugin, so that's installed separately from GitHub releases (works on
both x86_64 and ARM/Graviton instances):

```bash
sudo dnf install -y docker git tmux
sudo systemctl enable --now docker
sudo mkdir -p /usr/local/lib/docker/cli-plugins
ARCH=$(uname -m)
[ "$ARCH" = "aarch64" ] && COMPOSE_ARCH="aarch64" || COMPOSE_ARCH="x86_64"
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
sudo docker compose version
```

## 2. Get the code onto the instance

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

## 3. Configure secrets (one paste, no editor)

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

## 4. Bring it up

```bash
sudo docker compose up -d --build
```

This is the step most likely to outlast a flaky connection — that's
what `tmux` is for. If you get disconnected, reconnect and run
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

## 5. Register slash commands (one-time, and again whenever commands change)

```bash
sudo docker compose run --rm bot node src/deploy-commands.js
```

## 6. Confirm it's alive

In Discord, run `/payout for:` (or any command) and confirm autocomplete
and replies work.

## Updating after a code change

```bash
cd ~/zenithar_bot
git pull
sudo docker compose up -d --build
```

`restart: unless-stopped` on both services means the bot and DB also
survive instance reboots and crashes automatically — no extra systemd
unit needed, since Docker itself is enabled as a system service (step 1).

## Backups (not automated yet)

The Postgres data lives in a named Docker volume (`pgdata`) on the
instance's root EBS volume. If you want point-in-time recovery beyond
"the instance's disk still exists," consider a cron job running
`pg_dump` to an S3 bucket — not set up here, ask if you want it added.
