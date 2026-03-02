# Atlas Autonomous Core X

Production-grade simulation-first drone command platform with strict adapter boundaries.

## Stack
- API: Fastify + TypeScript + Prisma + Redis pub/sub + WebSocket
- Simulation: 20Hz physics engine with wind, acceleration constraints, battery drain, collision and geofence checks
- Frontend: React + Vite + CesiumJS + Zustand + Tailwind + Radix
- Infra: Docker Compose (`postgres`, `redis`, `api`, `simulation`, `frontend`)

## Quick Start
1. Copy env defaults:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Generate Prisma client + sync schema:
   ```bash
   npm run db:generate
   npm run db:push
   ```
4. Run API + simulation + frontend (separate shells):
   ```bash
   npm run dev:api
   npm run dev:sim
   npm run dev:frontend
   ```

## Docker Deployment
```bash
docker compose up --build
```
- Frontend: `http://localhost:8080`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

## Default Access
- Email: `admin@sgcx.local`
- Password: `ChangeMe123!`

Change these via `.env` in non-dev environments.

## Core Endpoints
- `POST /api/auth/login`
- `GET /api/drones`
- `POST /api/drones`
- `POST /api/drones/:id/command`
- `POST /api/missions`
- `GET /api/missions`
- `GET /api/geofences`
- `POST /api/geofences`
- `POST /api/admin/kill-switch`
- `GET /api/admin/audit`
- WebSocket: `/ws`
