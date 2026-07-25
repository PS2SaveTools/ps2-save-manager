#!/bin/sh

nginx -g "daemon off;" &
nginx_pid=$!

forward_term() {
  kill -TERM "$nginx_pid" 2>/dev/null || true
}

forward_quit() {
  kill -QUIT "$nginx_pid" 2>/dev/null || true
}

trap forward_term INT TERM
trap forward_quit QUIT

attempts=0

until wget --quiet --output-document=/dev/null http://127.0.0.1/healthz 2>/dev/null; do
  attempts=$((attempts + 1))

  if [ "$attempts" -ge 60 ]; then
    echo "PS2 Save Manager did not become ready within 30 seconds." >&2
    forward_term
    wait "$nginx_pid" 2>/dev/null
    exit 1
  fi

  sleep 0.5
done

echo
echo "PS2 Save Manager is ready."
echo "Open the web UI at http://localhost:8080"
echo "This address assumes the container was started with -p 8080:80."
echo "If you published a different host port, use that port instead."
echo

nginx_status=0

while kill -0 "$nginx_pid" 2>/dev/null; do
  wait "$nginx_pid"
  nginx_status=$?
done

exit "$nginx_status"
