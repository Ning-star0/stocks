#!/bin/bash
set -euo pipefail
cd /opt/stocks
test "$(pwd)" = "/opt/stocks"
echo "=== 检查公告 OCR 运行时 ==="
if ! command -v tesseract >/dev/null 2>&1; then
  echo "缺少 tesseract；请先安装 tesseract-ocr 和 tesseract-ocr-chi-sim。" >&2
  exit 1
fi
ocr_languages="$(tesseract --list-langs 2>/dev/null)"
for required_language in chi_sim eng; do
  if ! grep -qx "$required_language" <<<"$ocr_languages"; then
    echo "Tesseract 缺少 $required_language 语言包；部署已停止，避免扫描公告静默不可读。" >&2
    exit 1
  fi
done
echo "=== 拉取代码 ===" && git pull origin main
echo "=== 安装依赖 ===" && npm ci
echo "=== 生成 Prisma ===" && npx prisma generate
echo "=== 数据库迁移 ===" && npx prisma migrate deploy
echo "=== 隔离数据库端到端验收 ===" && npm run test:db:isolated
echo "=== 清理旧构建 ===" && rm -rf .next
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
