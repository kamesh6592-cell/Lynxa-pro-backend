import Nile from '@niledatabase/server';
import { getEnv } from './env.js';

const nile = Nile({
  user: getEnv('NILE_USER'),
  password: getEnv('NILE_PASSWORD'),
  basePath: getEnv('NILE_API')  // e.g., https://api.thenile.dev/databases/<db-id>
});

export default nile;
