#!/bin/sh

(
  attempts=0

  until wget --quiet --output-document=/dev/null http://127.0.0.1/ 2>/dev/null; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "PS2 Save Manager did not become ready within 30 seconds." >&2
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
) &
