#!/bin/bash
# Powerline statusline for Claude Code. Never errors out.
export LC_ALL=en_US.UTF-8
export GIT_OPTIONAL_LOCKS=0

input=$(cat 2>/dev/null)

JQ=/usr/bin/jq
[ -x "$JQ" ] || JQ=$(command -v jq 2>/dev/null)

SEP=$'\x1f'
fields=$(printf '%s' "$input" | "$JQ" -r '
  [ (.workspace.current_dir // .cwd // ""),
    (.session_id // ""),
    (.model.display_name // ""),
    (.context_window.total_output_tokens // ""),
    (.cost.total_api_duration_ms // ""),
    (.context_window.context_window_size // ""),
    (if .context_window.current_usage == null then ""
     else ((.context_window.current_usage.input_tokens // 0)
         + (.context_window.current_usage.cache_creation_input_tokens // 0)
         + (.context_window.current_usage.cache_read_input_tokens // 0)) end)
  ] | map(tostring) | join("\u001f")' 2>/dev/null)

IFS="$SEP" read -r dir sid model out_tok api_ms ctx_total ctx_used <<EOF
$fields
EOF

num() { case "$1" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }

ESC=$'\e'
RST="${ESC}[0m"
CL=$'\xee\x82\xb6'   # U+E0B6 rounded left cap
CR=$'\xee\x82\xb4'   # U+E0B4 rounded right cap
RA=$'\xee\x82\xb0'   # U+E0B0 right chevron
LA=$'\xee\x82\xb2'   # U+E0B2 left chevron

fgc() { printf '%s[38;2;%s;%s;%sm' "$ESC" "$1" "$2" "$3"; }
bgc() { printf '%s[48;2;%s;%s;%sm' "$ESC" "$1" "$2" "$3"; }

# Muted palette
F_R=59;  F_G=66;  F_B=82     # folder bg #3B4252
B_R=76;  B_G=86;  B_B=106    # branch bg #4C566A
M_R=59;  M_G=66;  M_B=82     # model bg
TX_R=160; TX_G=168; TX_B=184 # muted fg #A0A8B8
DK_R=30; DK_G=30; DK_B=30    # dark text

# lerp a b t(0..1000)
lerp() { echo $(( $1 + ($2 - $1) * $3 / 1000 )); }

RED_R=255; RED_G=0;   RED_B=0
SCA_R=255; SCA_G=36;  SCA_B=0
AMB_R=255; AMB_G=176; AMB_B=0
GRN_R=46;  GRN_G=204; GRN_B=64
# Three-stop gradient: sets GR GG GB from t (0..1000): c0 -> c1 (t=500) -> c2
grad3() { # t c0r c0g c0b c1r c1g c1b c2r c2g c2b
  local t=$1
  [ "$t" -lt 0 ] && t=0
  [ "$t" -gt 1000 ] && t=1000
  if [ "$t" -le 500 ]; then
    local u=$(( t * 2 ))
    GR=$(lerp $2 $5 $u); GG=$(lerp $3 $6 $u); GB=$(lerp $4 $7 $u)
  else
    local u=$(( (t - 500) * 2 ))
    GR=$(lerp $5 $8 $u); GG=$(lerp $6 ${9} $u); GB=$(lerp $7 ${10} $u)
  fi
}

# Compact token format
fmt() {
  local n=$1
  if ! num "$n"; then printf '—'; return; fi
  if [ "$n" -lt 1000 ]; then printf '%s' "$n"
  elif [ "$n" -lt 1000000 ]; then printf '%sk' $(( (n + 500) / 1000 ))
  else
    local t=$(( (n + 50000) / 100000 ))
    if [ $(( t % 10 )) -eq 0 ]; then printf '%sM' $(( t / 10 ))
    else printf '%s.%sM' $(( t / 10 )) $(( t % 10 )); fi
  fi
}

# ---------- Left: folder + branch ----------
folder="—"
[ -n "$dir" ] && folder=$(basename "$dir" 2>/dev/null)
[ -z "$folder" ] && folder="—"

branch=""
if [ -n "$dir" ] && [ -d "$dir" ]; then
  branch=$(git -C "$dir" branch --show-current 2>/dev/null)
  if [ -z "$branch" ]; then
    branch=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null)
  fi
fi

left_plain=" $folder "
left="$(bgc $F_R $F_G $F_B)$(fgc $TX_R $TX_G $TX_B) $folder "
if [ -n "$branch" ]; then
  left="$left$(fgc $F_R $F_G $F_B)$(bgc $B_R $B_G $B_B)$RA"
  left="$left$(fgc $TX_R $TX_G $TX_B) $branch "
  left="$left${RST}$(fgc $B_R $B_G $B_B)$RA${RST}"
  left_plain="$left_plain$RA $branch $RA"
else
  left="$left${RST}$(fgc $F_R $F_G $F_B)$RA${RST}"
  left_plain="$left_plain$RA"
fi

# ---------- Centre: TPS pill ----------
tps=""
cache="${TMPDIR:-/tmp}/claude-sl-${sid:-nosession}"
prev_out=""; prev_ms=""; prev_tps=""
if [ -f "$cache" ]; then
  read -r prev_out prev_ms prev_tps < "$cache" 2>/dev/null
fi
if num "$out_tok" && num "$api_ms"; then
  if num "$prev_out" && num "$prev_ms"; then
    d_out=$(( out_tok - prev_out )); d_ms=$(( api_ms - prev_ms ))
    if [ "$d_out" -gt 0 ] && [ "$d_ms" -gt 0 ]; then
      tps=$(( (d_out * 1000 + d_ms / 2) / d_ms ))
    fi
  fi
  if [ -z "$tps" ] && num "$prev_tps"; then tps=$prev_tps; fi
  if [ -z "$tps" ] && [ "$api_ms" -gt 0 ] && [ "$out_tok" -gt 0 ]; then
    tps=$(( (out_tok * 1000 + api_ms / 2) / api_ms ))
  fi
  printf '%s %s %s\n' "$out_tok" "$api_ms" "${tps:--}" > "$cache" 2>/dev/null
else
  if num "$prev_tps"; then tps=$prev_tps; fi
fi

if num "$tps"; then
  tps_text="⚡ ${tps} tok/s"
  t=$(( (tps - 20) * 1000 / 80 ))
  [ "$t" -lt 0 ] && t=0
  [ "$t" -gt 1000 ] && t=1000
  grad3 $t $RED_R $RED_G $RED_B $AMB_R $AMB_G $AMB_B $GRN_R $GRN_G $GRN_B
  if [ "$tps" -le 20 ]; then
    txt="${ESC}[1m$(fgc 255 255 255)"
  else
    txt="$(fgc $DK_R $DK_G $DK_B)"
  fi
  pr=$GR; pg=$GG; pb=$GB
else
  tps_text="⚡ — tok/s"
  pr=$B_R; pg=$B_G; pb=$B_B
  txt="$(fgc $TX_R $TX_G $TX_B)"
fi
pill="$(fgc $pr $pg $pb)$CL$(bgc $pr $pg $pb)${txt} ${tps_text} ${RST}$(fgc $pr $pg $pb)$CR${RST}"
pill_plain="$CL ${tps_text} $CR"

# ---------- Right: context + model ----------
used_txt=$(fmt "$ctx_used"); total_txt=$(fmt "$ctx_total")
ctx_text="${used_txt}/${total_txt}"
if num "$ctx_used"; then
  t=$(( (ctx_used - 50000) * 1000 / 150000 ))
  [ "$t" -lt 0 ] && t=0
  [ "$t" -gt 1000 ] && t=1000
  grad3 $t $GRN_R $GRN_G $GRN_B $AMB_R $AMB_G $AMB_B $SCA_R $SCA_G $SCA_B
  cr=$GR; cg=$GG; cb=$GB
  if [ "$ctx_used" -ge 200000 ]; then
    ctxt="${ESC}[1m$(fgc 255 255 255)"
  else
    ctxt="$(fgc $DK_R $DK_G $DK_B)"
  fi
else
  cr=$B_R; cg=$B_G; cb=$B_B
  ctxt="$(fgc $TX_R $TX_G $TX_B)"
fi
[ -z "$model" ] && model="—"
right="$(fgc $cr $cg $cb)$LA$(bgc $cr $cg $cb)${ctxt} ${ctx_text} ${RST}"
right="$right$(fgc $M_R $M_G $M_B)$(bgc $cr $cg $cb)$LA$(bgc $M_R $M_G $M_B)$(fgc $TX_R $TX_G $TX_B) ${model} ${RST}"
right_plain="$LA ${ctx_text} $LA ${model} "

# ---------- Layout ----------
W=${COLUMNS:-}
num "$W" || W=$(tput cols 2>/dev/null)
num "$W" || W=120
W=$(( W - 2 ))

L=${#left_plain}; P=${#pill_plain}; R=${#right_plain}
pad1=$(( (W - P) / 2 - L ))
[ "$pad1" -lt 1 ] && pad1=1
pad2=$(( W - L - pad1 - P - R ))
[ "$pad2" -lt 1 ] && pad2=1

printf '%s%*s%s%*s%s%s\n' "$left" "$pad1" "" "$pill" "$pad2" "" "$right" "$RST"
exit 0
