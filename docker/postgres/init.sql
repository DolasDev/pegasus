-- Run once on first container start (docker-entrypoint-initdb.d).
-- Creates the non-default schema and extension that Prisma expects.

-- The public schema already exists; create the platform schema for admin tables.
CREATE SCHEMA IF NOT EXISTS platform;

-- Required by Prisma's uuid-ossp extension declaration in schema.prisma.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
