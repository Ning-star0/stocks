import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];

if (!password || password.length < 16) {
  console.error("请传入至少 16 位的强密码，例如：npm run auth:hash -- \"你的强密码\"");
  process.exitCode = 1;
} else {
  const salt = randomBytes(18).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  const authSecret = randomBytes(48).toString("base64url");

  console.log(`ADMIN_PASSWORD_HASH="scrypt$${salt}$${hash}"`);
  console.log(`AUTH_SECRET="${authSecret}"`);
}
