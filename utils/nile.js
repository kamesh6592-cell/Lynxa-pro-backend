import Nile from '@niledatabase/server';
import { getEnv } from './env.js';

export default async function getNile() {
  try {
    const nile = await Nile({
      user: getEnv('NILE_USER'),
      password: getEnv('NILE_PASSWORD'),
      basePath: getEnv('NILE_API'),
      databaseId: getEnv('NILE_DATABASE_ID'),  // Optional: If provided by Vercel
    });
    return nile;
  } catch (error) {
    console.error('Nile init error:', error);
    throw error;
  }
}
