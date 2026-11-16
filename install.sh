#!/bin/sh
# Install 网闸 · 基础版 (dsh-netgate) into dsh-go:
# copy the plugin, prepare the process-level network guard, and register it in
# the web profile.
#
# Existing installation of the older "local-web-toggle" plugin: remove it first,
# they both drive the same netguard lock file.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
PLUGINS=$DSH_HOME/dsh-go/plugins
DEST=$PLUGINS/dsh-netgate
GUARD=$DSH_HOME/dsh-go/netguard

echo "网闸 · 基础版 (dsh-netgate 0.1.0)"
echo "DSH_HOME=$DSH_HOME"

if [ "$HERE" = "$DEST" ]; then
  echo "plugin already at $DEST"
else
  mkdir -p "$PLUGINS"
  rm -rf "$DEST"
  cp -R "$HERE" "$DEST"
  chmod 755 "$DEST/install.sh" 2>/dev/null || true
  echo "plugin -> $DEST"
fi

mkdir -p "$GUARD"
if [ -f "$HERE/netguard/netguard.so" ]; then
  cp "$HERE/netguard/netguard.so" "$GUARD/netguard.so"
  echo "netguard.so -> $GUARD/netguard.so"
fi
if [ ! -f "$GUARD/netguard.so" ]; then
  if command -v tcc >/dev/null 2>&1; then
    tcc -shared -fPIC -o "$GUARD/netguard.so" "$HERE/netguard/netguard.c" && echo "built netguard.so with tcc"
  elif command -v gcc >/dev/null 2>&1; then
    gcc -shared -fPIC -O2 -o "$GUARD/netguard.so" "$HERE/netguard/netguard.c" && echo "built netguard.so with gcc"
  else
    echo "warning: netguard.so missing and no compiler found (install tcc or gcc)" >&2
  fi
fi

# The plugin rewrites this on load too; writing it here guards the first shell
# after installation.
if [ -d /usr/local/bin ]; then
  if [ ! -e /usr/local/bin/bash ] || head -n 2 /usr/local/bin/bash 2>/dev/null | grep -q 'dsh-netguard wrapper'; then
    cat > /usr/local/bin/bash <<'WRAP'
#!/bin/sh
# dsh-netguard wrapper: when the web switch is off, load the connect() guard into
# this shell and everything it spawns.
H=${DSH_HOME:-$HOME/.dsh}
G="$H/dsh-go/netguard/netguard.so"
L="$H/dsh-go/netguard.lock"
if [ -f "$L" ] && [ -f "$G" ]; then
  DSH_NETGUARD_LOCK="$L"
  LD_PRELOAD="$G${LD_PRELOAD:+:$LD_PRELOAD}"
  export DSH_NETGUARD_LOCK LD_PRELOAD
fi
if [ -x /usr/bin/bash ]; then exec /usr/bin/bash "$@"; fi
exec /bin/bash "$@"
WRAP
    chmod 755 /usr/local/bin/bash
    echo "bash wrapper -> /usr/local/bin/bash"
  else
    echo "warning: /usr/local/bin/bash exists and is not ours; left untouched" >&2
  fi
fi

if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile web add "$DEST"
  echo "registered in profile: web"
else
  echo "dsh not found; add the plugin later with: dsh plugin --profile web add $DEST" >&2
fi

cat <<'DONE'

装好了：回到对话页，输入框上方应出现「联网：开 · 点关」。
面板在「全部功能 -> 网闸 · 基础版」。
DONE
