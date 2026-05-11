#!/bin/bash
set -e
cd /opt/stocks
echo "=== 拉取代码 ===" && git pull origin main
echo "=== 安装依赖 ===" && npm install
echo "=== 清理旧构建 ===" && rm -rf .next
echo "=== 生成 Prisma ===" && npx prisma generate
echo "=== 数据库迁移 ===" && npx prisma migrate deploy
echo "=== 构建 ===" && npm run build
echo "=== 复制静态文件 ===" && cp -r .next/static .next/standalone/.next/static
echo "=== 重启服务 ==="
pm2 delete stocks 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
cp .env .next/standalone/.env
pm2 start node --name "stocks" -- .next/standalone/server.js
pm2 restart worker 2>/dev/null || pm2 start npm --name "worker" -- run worker
pm2 save
echo "=== 完成 ===" && pm2 list
