// Tiny helper: load .env (Node >= 20.12) without extra dependencies.
import { existsSync } from 'node:fs';
export function loadEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  return process.env;
}
