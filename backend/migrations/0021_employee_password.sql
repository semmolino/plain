-- Migration 0021: Add PASSWORD column to EMPLOYEE for custom JWT authentication
ALTER TABLE public."EMPLOYEE"
  ADD COLUMN IF NOT EXISTS "PASSWORD" text;
