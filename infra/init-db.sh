#!/bin/sh
# Runs once, on first Postgres start, before anything connects.
#
# POSTGRES_DB already created `bext` (application data). n8n needs its own
# database for workflow metadata — keeping the two apart means a Postgres
# restore of application data never clobbers workflows, and vice versa.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE n8n OWNER $POSTGRES_USER;
EOSQL

echo "init-db: created database 'n8n' (workflow metadata); 'bext' (application data) already present"
