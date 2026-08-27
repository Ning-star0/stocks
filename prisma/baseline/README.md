# 隔离数据库测试基线

`current-schema.sql` 是仅供一次性隔离 PostgreSQL schema 使用的当前结构基线，不是生产迁移，也不得标记为已执行的生产迁移。

生成命令：

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script --output prisma/baseline/current-schema.sql
```

规则：

- 生产升级只能运行 `prisma migrate deploy`，不得使用本基线覆盖 `public`。
- 不得修改已在生产执行的历史迁移或校验和。
- `npm run test:db:isolated` 会先重新生成内存中的当前 schema SQL，并与本文件逐字规范化比较；不一致时在创建任何临时 schema 前失败。
- 比较通过后，脚本创建随机 `codex_e2e_*` schema、应用本基线、运行数据库测试并在 `finally` 中级联删除。
- schema 变更时必须重新生成并审查本基线，同时保留对应 Prisma migration。
