#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
umask 077

if (( EUID != 0 || $# != 3 )); then
  printf 'Usage as root: bash configure.sh HOST PUBLIC_IPV4 LOCAL_IPV4\n' >&2
  exit 2
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository=$(cd -- "$source_dir/../.." && pwd)
node=/opt/miemie-node/bin/node
read -r host public_ip local_ip < <("$node" --input-type=module - "$@" <<'JS'
import {isIPv4} from 'node:net';
const [host, publicIp, localIp] = process.argv.slice(2);
if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || !isIPv4(publicIp) || !isIPv4(localIp)) process.exit(2);
console.log(host, publicIp, localIp);
JS
)
version=$("$node" -p 'require(process.argv[1]).version' "$repository/package.json")
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
id turnserver >/dev/null
test -x /usr/bin/turnserver

project=/opt/MieMie-Multiplayer-Lobby
release=$project/releases/$version
configuration=/etc/miemie-multiplayer-lobby
install -d -m 0755 "$project" "$project/releases"
install -d -m 0750 -o root -g turnserver "$configuration"
stage=$(mktemp -d "$project/.stage.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT

if [ ! -e "$release" ]; then
  install -d -m 0755 "$stage/release" "$stage/release/server" "$stage/release/server/turn"
  install -m 0644 "$repository/package.json" "$stage/release/"
  install -m 0644 "$source_dir/credentials.mjs" "$stage/release/server/turn/"
  mv -T -- "$stage/release" "$release"
fi
cmp -s "$source_dir/credentials.mjs" "$release/server/turn/credentials.mjs"
"$node" --check "$release/server/turn/credentials.mjs"
runuser -u nobody -- test -r "$release/server/turn/credentials.mjs"

if [ ! -e "$configuration/turn-secret" ]; then
  openssl rand -hex 32 > "$stage/turn-secret"
  install -m 0600 "$stage/turn-secret" "$configuration/turn-secret"
fi
python3 - "$source_dir" "$stage" "$host" "$public_ip" "$local_ip" "$configuration/turn-secret" <<'PY'
from pathlib import Path
import re
import sys

source, stage, host, public_ip, local_ip, secret_file = sys.argv[1:]
secret = Path(secret_file).read_text().strip()
if not re.fullmatch(r'[0-9a-f]{64}', secret):
    raise SystemExit('Invalid TURN secret')
source_dir, stage_dir = Path(source), Path(stage)
values = {'@HOST@': host, '@PUBLIC_IP@': public_ip, '@LOCAL_IP@': local_ip, '@SECRET@': secret}
for name in ('turnserver.conf', 'Caddyfile'):
    text = (source_dir / f'{name}.in').read_text()
    for key, value in values.items():
        text = text.replace(key, value)
    (stage_dir / name).write_text(text)
(stage_dir / 'credentials.env').write_text(f'MIEMIE_TURN_HOST={host}\n')
PY
install -m 0640 -o root -g turnserver "$stage/turnserver.conf" "$configuration/"
runuser -u turnserver -- test -r "$configuration/turnserver.conf"
install -m 0600 "$stage/credentials.env" "$configuration/"
install -m 0644 "$stage/Caddyfile" /etc/caddy/miemie-multiplayer-lobby.Caddyfile
install -m 0644 "$source_dir/"*.service /etc/systemd/system/
ln -s "$release" "$stage/current"
mv -Tf -- "$stage/current" "$project/current"
systemctl daemon-reload
printf 'Prepared MieMie Multiplayer Lobby %s at %s\n' "$version" "$release"
