-- Fictional demo databases
SELECT 'CREATE DATABASE atlas_logistics'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'atlas_logistics')\gexec
SELECT 'CREATE DATABASE maghreb_freight'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'maghreb_freight')\gexec
SELECT 'CREATE DATABASE sahara_transport'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sahara_transport')\gexec
SELECT 'CREATE DATABASE sovereignty_audit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sovereignty_audit')\gexec
