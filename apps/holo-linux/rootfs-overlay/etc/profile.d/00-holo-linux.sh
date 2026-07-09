# /etc/profile.d/00-holo-linux.sh — Holo Linux login banner.
# Runs from /etc/profile's run-parts loop for every login shell. Everything printed
# here is produced BY THE GUEST at login: uname, /etc/os-release, /proc — no host
# text is injected. Guarded so it shows once per boot, not on every subshell.

# A real interactive terminal: announce 256-color + UTF-8 so colour/box-drawing work.
case "$TERM" in
  xterm | xterm-color | "" ) export TERM=xterm-256color ;;
esac

# Give the machine a name (kernel hostname was "(none)"); no binary needed, just procfs.
if [ "$(cat /proc/sys/kernel/hostname 2>/dev/null)" = "(none)" ] && [ -w /proc/sys/kernel/hostname ]; then
  echo holo > /proc/sys/kernel/hostname 2>/dev/null || true
fi

# A real, colour prompt. bash captures the hostname for \h ONCE at startup, so \h
# would still print the old "(none)"; read the live hostname from procfs instead.
if [ -n "$PS1" ]; then
  _hn=$(cat /proc/sys/kernel/hostname 2>/dev/null); [ -z "$_hn" ] || [ "$_hn" = "(none)" ] && _hn=holo
  PS1='\[\033[01;32m\]\u@'"$_hn"'\[\033[0m\]:\[\033[01;34m\]\w\[\033[0m\]\$ '
  # `help` is a bash builtin; alias it so the banner's command runs OUR script (aliases win).
  alias help='/usr/local/bin/help'
fi

# Show the banner once per boot (not for nested login shells).
if [ -n "$PS1" ] && [ -z "$HOLO_MOTD_SHOWN" ]; then
  export HOLO_MOTD_SHOWN=1

  _krel=$(uname -r 2>/dev/null); _arch=$(uname -m 2>/dev/null)
  _distro=$(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")
  _cpus=$(nproc 2>/dev/null)
  _isa=$(awk -F': ' '/^isa/{print $2; exit}' /proc/cpuinfo 2>/dev/null)
  _mmu=$(awk -F': ' '/^mmu/{print $2; exit}' /proc/cpuinfo 2>/dev/null)
  _memkb=$(awk '/^MemTotal/{print $2; exit}' /proc/meminfo 2>/dev/null)
  _memmb=$(( ${_memkb:-0} / 1024 ))
  _up=$(awk '{printf "%d.%02ds", $1, ($1-int($1))*100; exit}' /proc/uptime 2>/dev/null)

  # ANSI: 39=tux body, 220=beak/feet, 244=dim, 51=accent
  B=$'\033[38;5;39m'; Y=$'\033[38;5;220m'; D=$'\033[38;5;244m'; A=$'\033[1;38;5;51m'; R=$'\033[0m'

  printf '\n'
  printf '   %s.--.%s          %sHolo Linux%s\n'                "$B" "$R" "$A" "$R"
  printf '  %s|o_o |%s         %sA real %s Linux, κ-verified and booted in a browser tab.%s\n' "$B" "$R" "$D" "$_arch" "$R"
  printf '  %s|:_/ |%s\n'                                       "$B" "$R"
  printf ' %s//   \\ \\%s        %skernel %s   %s%s\n'           "$B" "$R" "$D" "$R" "$B" "$_krel"
  printf '%s(|     | )%s       %sdistro %s   %s%s\n'            "$B" "$R" "$D" "$R" "$B" "${_distro:-Debian}"
  printf '%s/'"'"'\\_   _/`\\%s      %scpu    %s   %s%s hart · %s%s\n' "$B" "$R" "$D" "$R" "$B" "${_cpus:-1}" "${_isa:-riscv64}" "$R"
  printf '%s\\___)=(___/%s      %smemory %s   %s%s MiB · mmu %s%s\n'   "$B" "$R" "$D" "$R" "$B" "$_memmb" "${_mmu:-sv57}" "$R"
  printf '                %suptime %s   %s%s%s\n'               "$D" "$R" "$B" "${_up:-0s}" "$R"
  printf '\n'
  printf '  %sAnchored in the κ-substrate — kernel + rootfs admitted by content\n' "$D"
  printf '  address, not by trust (Law L5). Tamper one byte and the boot refuses.%s\n' "$R"
  printf '\n'
  printf '  %s%-13s%s what can I run here\n'                       "$A" "help"        "$R"
  printf '  %s%-13s%s prove this is a real Linux kernel\n'          "$A" "verify"      "$R"
  printf '  %s%-13s%s no server — the whole OS runs in this tab\n'  "$A" "serverless"  "$R"
  printf '  %s%-13s%s every byte has a content address (κ)\n'       "$A" "fingerprint" "$R"
  printf '  %s%-13s%s flip one byte and it will not boot\n'         "$A" "tamper"      "$R"
  printf '  %s%-13s%s your work survives a reboot, no server\n'     "$A" "persist"     "$R"
  printf '  %s%-13s%s rebuild this exact machine from a hash\n'     "$A" "reproduce"   "$R"
  printf '\n'
fi
