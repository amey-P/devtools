#!/bin/sh
# Fake `herdr-app` for tests: logs argv and prints canned JSON shaped like the real app.
#   FAKE_APP_LOG   append one line per call: args joined by '|'
#   FAKE_APP_DOWN  every call fails like a closed window
#   FAKE_APP_PARKED     t3f has no pane
#   FAKE_APP_OTHER_TAB  status shows another tab than t1's

if [ -n "$FAKE_APP_LOG" ]; then
	{ for a in "$@"; do printf '%s|' "$a"; done; echo; } >>"$FAKE_APP_LOG"
fi
if [ -n "$FAKE_APP_DOWN" ]; then
	echo "herdr-app: no window is running" >&2
	exit 1
fi

case "$1" in
ls)
	if [ -n "$FAKE_APP_PARKED" ]; then p1=null; else p1='"p1"'; fi
	echo '{"spaces":[{"id":"sp1","name":"~","tabs":[{"id":"tb1","name":"1","terminals":[{"terminal":"t1","pane":"p0","sub_agents":["t3f"]},{"terminal":"t3f","pane":'"$p1"'},{"terminal":"t8","pane":"p8"}]}]}]}'
	;;
status)
	if [ -n "$FAKE_APP_OTHER_TAB" ]; then tab=tb9; else tab=tb1; fi
	echo '{"space":"sp1","tab":"'"$tab"'","focused_pane":"p0","errors":[]}'
	;;
do)
	case "$3" in
	*'"pane":"p9"'*) echo '{"error":"no such pane"}'; exit 1 ;;
	*) echo '{"ok":true}' ;;
	esac
	;;
*)
	echo '{"error":"unknown command"}'
	exit 1
	;;
esac
