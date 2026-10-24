#!/bin/sh
# Points a DuckDNS subdomain at this host's public IPv4 address.
#
#   DUCKDNS_DOMAIN=agentic-qa DUCKDNS_TOKEN=<account token> deploy/duckdns-update.sh
#
# An empty "ip" parameter makes DuckDNS use the address the request comes
# from, so this works behind NAT without knowing the public IP. Run it from
# cron to follow a dynamic address; it is idempotent.
set -eu

: "${DUCKDNS_DOMAIN:?set DUCKDNS_DOMAIN to the subname (without .duckdns.org)}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN to the DuckDNS account token}"

url="https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="

response=$(curl -fsS --max-time 10 "$url") || {
  echo "duckdns: request to duckdns.org failed" >&2
  exit 1
}

if [ "$response" != "OK" ]; then
  echo "duckdns: duckdns.org answered '$response' (check the domain and token)" >&2
  exit 1
fi

echo "duckdns: ${DUCKDNS_DOMAIN}.duckdns.org now points at this host"
