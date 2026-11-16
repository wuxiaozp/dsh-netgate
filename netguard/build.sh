#!/bin/sh
# Rebuild netguard.so for this machine's architecture/libc.
set -eu
cd "$(dirname "$0")"
if command -v tcc >/dev/null 2>&1; then
  tcc -shared -fPIC -o netguard.so netguard.c
elif command -v gcc >/dev/null 2>&1; then
  gcc -shared -fPIC -O2 -o netguard.so netguard.c
else
  echo "need tcc or gcc (and libc headers): apt-get install -y tcc libc6-dev" >&2
  exit 1
fi
echo "netguard.so rebuilt: $(uname -m)"
