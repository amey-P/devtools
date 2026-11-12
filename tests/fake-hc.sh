#!/bin/sh
# Fake `hc` for tests: logs argv and prints canned JSON shaped like real hc.
#   FAKE_HC_LOG           append one line per call: args joined by '|'
#   FAKE_HC_NO_TEMPLATES  templates returns none
#   FAKE_HC_ERR=blocked   send fails with hc's blocked error (exit 9)
#   FAKE_HC_SLOW=N        wait sleeps N seconds (pid written to FAKE_HC_PIDFILE)
#   FAKE_HC_UNDELIVERED   run reports first_message.sent=false

if [ -n "$FAKE_HC_LOG" ]; then
	{ for a in "$@"; do printf '%s|' "$a"; done; echo; } >>"$FAKE_HC_LOG"
fi

cmd=$1
case "$cmd" in
templates)
	if [ -n "$FAKE_HC_NO_TEMPLATES" ]; then
		echo '{"templates":[{"name":"claude-fix","description":"not a role","command":"claude"}]}'
	else
		echo '{"templates":[{"name":"scout","description":"Fast lookup","command":"HC_SUBAGENT_ROLE=scout /opt/homebrew/bin/pi --tools read"},{"name":"reviewer","description":"Legacy review","command":"/opt/homebrew/bin/pi --subagent-role reviewer"},{"name":"claude-fix","description":"not a role","command":"claude"}]}'
	fi
	;;
ls)
	echo '{"terminals":[{"address":"t3f","agent":"sh","cwd":"/","name":"scout","parent":"t1","state":"live","status":"idle","template":"scout","turn":1,"where":"local"},{"address":"t9","agent":"pi","cwd":"/","name":"other","parent":"t7","state":"live","status":"working","template":null,"turn":0,"where":"local"}]}'
	;;
run)
	if [ -n "$FAKE_HC_UNDELIVERED" ]; then
		echo '{"address":"t40","agent":"sh","name":"x","parent":"t1","state":"live","template":"scout","turn":0,"first_message":{"sent":false,"started":false,"turn":0,"reason":"dialog open"}}'
	else
		echo '{"address":"t40","agent":"sh","cwd":"/","first_message":{"sent":true,"started":true,"turn":0},"name":"x","parent":"t1","state":"live","template":"scout","turn":0}'
	fi
	;;
send)
	if [ "$FAKE_HC_ERR" = blocked ]; then
		echo '{"error":{"kind":"blocked","message":"t3f is blocked","hint":"a person must answer"}}' >&2
		exit 9
	fi
	case " $* " in
	*" --wait "*) echo '{"started":true,"status":"working","turn":1,"wait":{"children":[],"ended":true,"exit_code":null,"reason":"status","signal":null,"status":"done","turn":2}}' ;;
	*) echo '{"started":true,"status":"idle","turn":0}' ;;
	esac
	;;
wait)
	if [ -n "$FAKE_HC_SLOW" ]; then
		[ -n "$FAKE_HC_PIDFILE" ] && echo $$ >"$FAKE_HC_PIDFILE"
		exec sleep "$FAKE_HC_SLOW"
	fi
	echo '{"children":[{"children":[],"ended":true,"exit_code":null,"reason":"status","signal":null,"status":"done","terminal":"t3f","turn":1}],"ended":false,"reason":"children","terminal":"t1"}'
	;;
read)
	printf 'line one   \n\n\n\n\nline two\n\n\n\n'
	;;
interrupt) echo '{"key":"esc","outcome":"stopped"}' ;;
kill)
	echo '{"error":{"kind":"finished","message":"already finished"}}' >&2
	exit 11
	;;
rm) echo '{"removed":"t3f"}' ;;
get) echo '{"address":"t3f","parent":"t1","template":"scout","status":{"app":"pi","state":"working"}}' ;;
*)
	echo "{\"error\":{\"kind\":\"usage\",\"message\":\"unknown $cmd\"}}" >&2
	exit 2
	;;
esac
