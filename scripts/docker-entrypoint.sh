#!/bin/sh
# A volume mounted at /app/data starts out owned by root. Hand it to the node user,
# then run the server as that user.
set -e
chown node:node "${DATA_DIR:-/app/data}" 2>/dev/null || true
exec setpriv --reuid=node --regid=node --init-groups "$@"
