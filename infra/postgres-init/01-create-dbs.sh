#!/bin/bash
set -e
for svc in identity_access org channel_gateway conversation crm catalog class_schedule enrollment payment ai_agent notification reporting_audit; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<EOSQL
    CREATE USER $svc WITH PASSWORD '${svc}_dev';
    CREATE DATABASE $svc OWNER $svc;
EOSQL
done
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname catalog -c "CREATE EXTENSION IF NOT EXISTS vector;"