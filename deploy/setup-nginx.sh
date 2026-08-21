#!/bin/bash
# Aggancia JackOne al reverse proxy del server di sviluppo. Da eseguire come root:
#
#   echo <password> | su root -c /opt/jackone/deploy/setup-nginx.sh
#
# Idempotente: si puo' rieseguire dopo ogni modifica di deploy/nginx/jackone.conf.
#
# Vuole il server block condiviso gia' installato (repo local-proxy-dev): senza, non esiste
# nessun `server` che includa apps-enabled e nginx non saprebbe dove mettere questa
# location.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

APP_DIR=${APP_DIR:-/opt/jackone}
APPS_DIR=/etc/nginx/apps-enabled

if [ ! -e /etc/nginx/sites-enabled/00-condiviso ]; then
  echo "manca il server block condiviso: esegui prima /opt/local-proxy-dev/setup.sh" >&2
  exit 1
fi

install -d -m 0755 "$APPS_DIR"
install -m 0644 "$APP_DIR/deploy/nginx/jackone.conf" "$APPS_DIR/jackone.conf"

nginx -t
systemctl reload nginx
systemctl is-active nginx
echo "NGINX_OK"
