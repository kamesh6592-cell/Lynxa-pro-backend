// utils/nile.js
// THIS IS THE FIX: Use curly braces for a named import
import { Nile } from '@niledatabase/server'; 
import { getEnv } from './env.js';

export default async function getNile() {
  try {
    console.log('Attempting to initialize Nile client...');
    
    const connectionUrl = getEnv('NILEDB_URL');
    
    if (connectionUrl) {
      console.log('Initializing Nile with NILEDB_URL.');
      const nile = await Nile({
        db: connectionUrl,
        basePath: getEnv('NILEDB_API_URL') 
      });
      console.log('Nile client initialized successfully with connection string.');
      return nile;
    }

    console.log('NILEDB_URL not found. Initializing Nile with individual parameters.');
    const nile = await Nile({
      user: getEnv('NILEDB_USER'),
      password: getEnv('NILEDB_PASSWORD'),
      basePath: getEnv('NILEDB_API_URL'),
    });
    console.log('Nile client initialized successfully with individual parameters.');
    return nile;
  } catch (error) {
    console.error('Nile initialization failed. Details:', error);
    throw new Error(`Failed to initialize Nile DB: ${error.message}`);
  }
}
