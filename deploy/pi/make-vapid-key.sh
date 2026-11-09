#!/bin/sh
# Adds a VAPID_PRIVATE_KEY (web push signing key) to ~/smart-home-os/.env, once. Prints nothing
# secret. Run on the Pi from the repo folder: sh deploy/pi/make-vapid-key.sh
# Then recreate the gateway (docker compose up -d gateway) so it reads the new value.
# Changing the key later breaks every phone's subscription (each must turn notifications on again).
set -eu
cd "$(dirname "$0")/../.."
if grep -q '^VAPID_PRIVATE_KEY=.\+' .env 2>/dev/null; then
  echo "VAPID_PRIVATE_KEY is already set in .env; leaving it alone."
  exit 0
fi
key=$(docker exec home_gateway uv run --no-sync python -c "
import base64
from cryptography.hazmat.primitives.asymmetric import ec
k = ec.generate_private_key(ec.SECP256R1()).private_numbers().private_value.to_bytes(32, 'big')
print(base64.urlsafe_b64encode(k).rstrip(b'=').decode())")
sed -i '/^VAPID_PRIVATE_KEY=$/d' .env
printf '\nVAPID_PRIVATE_KEY=%s\n' "$key" >> .env
echo "Added VAPID_PRIVATE_KEY to .env."
