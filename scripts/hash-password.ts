import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];

if (!password || password.length < 16) {
  console.error('请传入至少 16 位的强密码，例如：npm run auth:hash -- "你的强密码"');
  process.exitCode = 1;
} else {
  const salt = randomBytes(18).toString("base64url");
  const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
  const hashB64 = Buffer.from(hash, "utf8").toString("base64url");
  const authSecret = randomBytes(48).toString("base64url");

  console.log(`ADMIN_PASSWORD_HASH=""`);
  console.log(`ADMIN_PASSWORD_HASH_B64="${hashB64}"`);
  console.log(`AUTH_SECRET="${authSecret}"`);
}
