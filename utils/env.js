// utils/env.js
export function getEnv(key, defaultValue = null) {
  const value = process.env[key];
  if (!value && defaultValue === null) {
    console.error(`Environment variable ${key} is not set`);
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value || defaultValue;
}
