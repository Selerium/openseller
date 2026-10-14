#!/usr/bin/env node
import { cleanupRefreshTokens, cleanupUnverifiedUsers } from "../lib/tokenCleanup.ts";

async function main() {
  const [tokens, users] = await Promise.all([
    cleanupRefreshTokens(),
    cleanupUnverifiedUsers(),
  ]);
  console.log(JSON.stringify({ tokens, users }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
