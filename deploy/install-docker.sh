#!/bin/bash
set -euo pipefail

sudo dnf install -y docker git tmux
sudo systemctl enable --now docker

ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
  COMPOSE_ARCH="aarch64"
  BUILDX_ARCH="arm64"
else
  COMPOSE_ARCH="x86_64"
  BUILDX_ARCH="amd64"
fi

BUILDX_VERSION=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)

for DIR in /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins; do
  sudo mkdir -p "$DIR"

  sudo curl -fSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" -o "$DIR/docker-compose"
  sudo chmod +x "$DIR/docker-compose"

  sudo curl -fSL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${BUILDX_ARCH}" -o "$DIR/docker-buildx"
  sudo chmod +x "$DIR/docker-buildx"
done

echo "Installed. Verifying:"
sudo docker compose version
sudo docker buildx version
