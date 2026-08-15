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

Multi-line pastes (heredocs, several stacked commands) are also the most
likely thing to get corrupted by a phone SSH client's paste handling —
lines can arrive out of order or get split mid-word. Everything from
here on is deliberately **one short line per step** for that reason. If
you ever need to run something longer, prefer cloning it as a file from
the repo (as in step 1 below) over pasting it inline.

## 1. Get the code onto the instance

You'll need a GitHub Personal Access Token (fine-grained, read-only,
scoped to `tbytnar/zenithar_bot`) since the repo is private —
generate one at https://github.com/settings/personal-access-tokens/new,
then substitute it directly into the command below (don't paste tokens
into chat with anyone, including an AI assistant). This is one line
even though it wraps visually:

```bash
git clone https://<YOUR_GITHUB_USERNAME>:<YOUR_PAT>@github.com/tbytnar/zenithar_bot.git && cd zenithar_bot
```

## 2. Install Docker, Compose, git, tmux

Amazon Linux 2023 ships Docker in its own repo but not the Compose
plugin, so `deploy/install-docker.sh` (already in the repo you just
cloned) installs Compose separately from GitHub releases — works on
both x86_64 and ARM/Graviton instances, and idempotent if you need to
re-run it:

```bash
bash deploy/install-docker.sh
```

The script ends by printing `docker compose version` — confirm it shows
a version number before moving on.

## 3. Configure secrets (short one-liners, no editor, no heredoc)

Start from the template:

```bash
cp .env.example .env
```

Then run each of these four, substituting your real value into each one
before you paste it (fill them in from a notes app if that's easier —
just don't send secrets to anyone else, AI included, while doing it):

```bash
sed -i "s|^DISCORD_TOKEN=.*|DISCORD_TOKEN=REPLACE_ME|" .env
```

```bash
sed -i "s|^DISCORD_CLIENT_ID=.*|DISCORD_CLIENT_ID=REPLACE_ME|" .env
```

```bash
sed -i "s|^DISCORD_GUILD_ID=.*|DISCORD_GUILD_ID=REPLACE_ME|" .env
```

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=REPLACE_ME|" .env
```

Get `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID` from your
Discord application (see README.md for where). For
`POSTGRES_PASSWORD`, any strong random string works. The `DATABASE_URL`
line in `.env` is unused by Compose — leave it as the template default.

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
```

```bash
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
cd ~/zenithar_bot && git pull && sudo docker compose up -d --build
```

`restart: unless-stopped` on both services means the bot and DB also
survive instance reboots and crashes automatically — no extra systemd
unit needed, since Docker itself is enabled as a system service (step 2).

## Backups

Daily `pg_dump` to S3 via cron, authenticated through an IAM role
attached to the instance (no AWS keys stored on disk). One-time setup:

### B1. Create the S3 bucket (AWS Console)

S3 console → **Create bucket**. Any unique name (e.g.
`zenithar-bot-backups-<your-account-id>`). Defaults (encryption on,
public access blocked) are fine — leave them.

### B2. Create an IAM policy scoped to that bucket

IAM console → **Policies** → **Create policy** → **JSON** tab, paste
(substituting your bucket name for `BUCKET_NAME` in both places):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::BUCKET_NAME/backups/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET_NAME" }
  ]
}
```

Name it something like `zenithar-bot-backup-writer`, create it.

### B3. Create an IAM role and attach it to the instance

IAM console → **Roles** → **Create role** → trusted entity type
**AWS service** → use case **EC2** → attach the policy from B2 →
name it (e.g. `zenithar-bot-backup-role`) → create.

Then: EC2 console → select the `keizaal-bot` instance → **Actions** →
**Security** → **Modify IAM role** → pick the role you just made →
**Update IAM role**. No reboot needed — the instance picks it up
immediately via the metadata service.

### B4. Install the AWS CLI and cron on the instance

```bash
bash deploy/install-backups.sh
```

Ends by printing `aws --version` — confirm it shows something before
continuing.

### B5. Set the bucket name and test a manual backup

```bash
grep -v '^BACKUP_S3_BUCKET=' .env > .env.tmp && mv .env.tmp .env && echo 'BACKUP_S3_BUCKET=REPLACE_ME' >> .env
```

(substitute your real bucket name for `REPLACE_ME`)

```bash
bash deploy/backup-db.sh
```

Should end with `Backup uploaded: s3://...`. Check the bucket in the
S3 console to confirm the object landed in it.

### B6. Schedule it daily via cron

```bash
(crontab -l 2>/dev/null; echo "0 6 * * * /home/ec2-user/zenithar_bot/deploy/backup-db.sh >> /home/ec2-user/backup.log 2>&1") | crontab -
```

Runs daily at 06:00 UTC. Confirm it's registered:

```bash
crontab -l
```

### Optional: auto-expire old backups

S3 console → your bucket → **Management** tab → **Create lifecycle
rule** → scope to prefix `backups/` → expire objects after however
many days you want to retain (e.g. 30). Cheaper than deleting them
from the script, and one less thing for `backup-db.sh` to get wrong.
