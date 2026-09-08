# 山海集

山海集是一款以旅行摄影册和手账地图为核心体验的旅行记录应用。

## 项目结构

- `shanhai-app/`：Vue 3 + TypeScript + Vite 前端
- `shanhai-api/`：NestJS + PostgreSQL + Sharp 后端
- `docs/山海集/`：产品设计、架构、代码结构和迭代计划

## 本地开发

### 前端

```bash
cd shanhai-app
npm install
npm run dev
```

### 后端

后端需要 PostgreSQL。配置数据库连接后：

```bash
cd shanhai-api
npm install
npm run build
npm run migrate
npm start
```

前端默认开发地址为 `http://127.0.0.1:5173`，后端默认使用本机回环地址提供 API。

## 质量检查

```bash
cd shanhai-app
npm run typecheck
npm test

cd ../shanhai-api
npm run build
npm test
```

## 当前范围

当前版本聚焦中国境内旅行足迹、景点回忆、照片叠片、精选封面、手记和账号同步基础能力。正式身份系统、云部署、全国完整地点目录、AI 地标识别与 3D 景点页面仍属于后续规划。
