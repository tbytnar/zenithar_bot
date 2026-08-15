#!/bin/bash
set -euo pipefail

sudo dnf install -y unzip cronie
sudo systemctl enable --now crond

ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
  AWSCLI_ARCH="aarch64"
else
  AWSCLI_ARCH="x86_64"
fi

cd /tmp
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWSCLI_ARCH}.zip" -o awscliv2.zip
unzip -o awscliv2.zip
sudo ./aws/install --update
rm -rf awscliv2.zip aws

echo "Installed. Verifying:"
aws --version
