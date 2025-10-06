import Nile from '@niledatabase/server';
import { getEnv } from './env.js';

export default async function getNile() {
  try {
    const nile = await Nile({
      user: getEnv('NILEDB_USER'),
      password: getEnv('NILEDB_PASSWORD'),
      basePath: getEnv('NILEDB_API_URL'),
      databaseId: getEnv('NILE_DATABASE_ID'),  // Optional: If provided by Vercel
    });
    return nile;
  } catch (error) {
    console.error('Nile init error:', error);
    throw error;
  }
}
