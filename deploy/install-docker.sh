#!/bin/bash
set -euo pipefail

sudo dnf install -y docker git tmux
sudo systemctl enable --now docker

ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
  COMPOSE_ARCH="aarch64"
else
  COMPOSE_ARCH="x86_64"
fi

for DIR in /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins; do
  sudo mkdir -p "$DIR"
  sudo curl -fSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" -o "$DIR/docker-compose"
  sudo chmod +x "$DIR/docker-compose"
done

echo "Installed. Verifying:"
sudo docker compose version
