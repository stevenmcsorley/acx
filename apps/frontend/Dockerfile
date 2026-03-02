FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_CESIUM_ION_TOKEN=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_CESIUM_ION_TOKEN=${VITE_CESIUM_ION_TOKEN}
COPY apps/frontend ./apps/frontend
RUN npm run build --workspace @sgcx/frontend

FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
