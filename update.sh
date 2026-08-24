#!/bin/bash
set -euo pipefail
cd /opt/stocks
test "$(pwd)" = "/opt/stocks"
echo "=== 拉取代码 ===" && git pull origin main
echo "=== 安装依赖 ===" && npm ci
echo "=== 清理旧构建 ===" && rm -rf .next
echo "=== 生成 Prisma ===" && npx prisma generate
echo "=== 数据库迁移 ===" && npx prisma migrate deploy
echo "=== 构建 ===" && npm run build
echo "=== 准备 standalone 环境 ==="
cp .env .next/standalone/.env
echo "=== 重启 systemd 服务 ==="
systemctl restart stocks-web.service
systemctl restart stocks-worker.service
echo "=== 健康检查 ==="
for attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/api/health; then
    echo
    systemctl --no-pager --full status stocks-web.service stocks-worker.service
    exit 0
  fi
  sleep 2
done
echo "健康检查失败" >&2
journalctl -u stocks-web.service -u stocks-worker.service -n 100 --no-pager >&2
exit 1
