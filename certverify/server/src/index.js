import config, { validateConfig } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';

validateConfig();
await connectDb();
const app = createApp();
app.listen(config.PORT, () => {
  console.log(`Certificate API listening on :${config.PORT} (${config.NODE_ENV})`);
  console.log(`Verification URLs will use: ${config.PUBLIC_APP_URL}/verify/<ID>`);
});
