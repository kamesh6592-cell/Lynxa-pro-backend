// utils/nile.js
import Nile from '@niledatabase/server';
import { getEnv } from './env.js';

export default async function getNile() {
  try {
    // Prioritize the full connection string if available
    const connectionUrl = getEnv('NILEDB_URL');
    
    if (connectionUrl) {
      console.log('Initializing Nile with connection string.');
      const nile = await Nile({
        db: { connectionString: connectionUrl }
      });
      return nile;
    }

    // Fallback to individual parameters if NILEDB_URL is not set
    console.log('Initializing Nile with individual parameters.');
    const nile = await Nile({
      user: getEnv('NILEDB_USER'),
      password: getEnv('NILEDB_PASSWORD'),
      basePath: getEnv('NILEDB_API_URL'),
    });
    return nile;
  } catch (error) {
    console.error('Nile initialization error:', error);
    throw error;
  }
}
