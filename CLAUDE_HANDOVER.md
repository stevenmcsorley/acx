# Atlas Autonomous Core X - Handover Notes

Last updated: February 27, 2026

## 1. Current Runtime State

- Frontend URL: `http://localhost:8080`
- API URL: `http://localhost:4000`
- Health check: `http://localhost:4000/health`
- Stack is running via Docker Compose (`frontend`, `api`, `simulation`, `postgres`, `redis`).

## 2. What Is Implemented and Working

- App branding renamed to **Atlas Autonomous Core X** across key UI/API surfaces.
- Drone simulation is active at configurable telemetry rate (`TELEMETRY_HZ`, default 20Hz).
- Drone starts on ground at home (not mid-air) when grounded/armed.
- Mission flow now supports:
  - Upload mission
  - Execute mission from explicit button
  - Mission auto-takeoff behavior in simulation when execution starts
- Home location update API + simulation sync works (`PATCH /api/drones/:id/home`).
- Camera follow mode was stabilized and now tracks selected drone consistently.

## 3. High-Impact Fixes Completed

### A) Follow camera drift / losing center

Symptoms seen:
- Follow camera drifted far away (global-like behavior)
- Camera stopped staying centered on selected drone

Fix implemented:
- Added per-tick follow/FPV camera lock in Cesium viewer so tracked entity is continuously reasserted.
- Tightened follow zoom bounds to keep orbit close.

Primary file:
- `apps/frontend/src/cesium/GlobeViewer.tsx`

### B) Execute Mission button returned 400

Symptoms seen:
- `POST /api/missions/:id/execute` returned `400 Bad Request`

Root cause:
- Frontend sent `Content-Type: application/json` with empty body.
- Fastify rejected with `FST_ERR_CTP_EMPTY_JSON_BODY`.

Fix implemented:
- API client now only adds JSON content type when request actually has JSON body.
- `executeMission` now sends auth headers without `Content-Type` and no body.

Primary file:
- `apps/frontend/src/api/client.ts`

Validation:
- Direct API execute call now returns `200` with `{"accepted": true, ...}`.

## 4. Current Data Snapshot

- Active mock fleet currently has **1 drone**:
  - `drone-1` / `Raven-1`
  - Home: `55.46731737317384, -4.589050193344799, alt 0`
- `GroundCheck` test drone has been removed from current DB state.

## 5. UX/Behavior Changes Already in Place

- Command panel text clarifies:
  - `Arm` is for manual ops.
  - Missions are executed explicitly (not by upload alone).
- Mission Planner has dedicated **Execute Mission** control.

Primary files:
- `apps/frontend/src/components/CommandPanel.tsx`
- `apps/frontend/src/components/MissionPlannerPanel.tsx`
- `apps/frontend/src/App.tsx`

## 6. Known Gaps / Requested Next Work

These were requested by user and are still open or partially open:

1. Manual flight mode UX and controls (stick-like/manual command mode).
2. Optional "record flight path" during manual mode and save as mission.
3. FPV mode should be strict camera POV (no user orbit), matching live feed concept.
4. Follow mode still needs polishing for tight, intuitive 360 orbit behavior at all zoom levels.
5. Mission UX messaging could be clearer during execution progress and state transitions.
6. Route transition smoothing (less abrupt turning between waypoints).

## 7. Key Backend Behavior to Know

- Mission execute publishes to Redis mission channel and sets mission status to `executing`.
- Mock adapter `uploadMission(...)` sets mission on drone and triggers takeoff if grounded/armed.
- Physics engine includes:
  - Turn-rate and acceleration limits
  - Wind drift
  - Battery drain + low battery RTL
  - Low signal RTL
  - Geofence breach RTL
  - Mission energy sufficiency forecast + abort to RTL when insufficient

Primary files:
- `apps/api/src/routes/missions.ts`
- `apps/api/src/adapters/MockDroneAdapter.ts`
- `apps/api/src/simulation/PhysicsEngine.ts`
- `apps/api/src/simulation-runner.ts`

## 8. Quick Verification Script (manual)

1. Hard refresh browser (`Ctrl+Shift+R`).
2. Select `drone-1`.
3. Create mission waypoints with click-to-place.
4. Click `Upload Mission`.
5. Click `Execute Mission`.
6. Confirm:
   - Drone takes off and tracks waypoints
   - Follow camera remains centered on selected drone
   - Telemetry mode updates (`mission-wp-x/y`)
   - Alerts stream updates as needed

## 9. Notes for Claude

- This repo currently has no local `.git` metadata in this workspace path, so use file diffs directly.
- Prefer source files under `apps/*/src` (ignore built `dist` artifacts for logic changes).
- If camera behavior regresses, start in `GlobeViewer.tsx` (camera mode effects + `onTick` listeners).
