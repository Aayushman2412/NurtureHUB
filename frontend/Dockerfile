# syntax=docker/dockerfile:1

# --- Stage 1: build the Vite SPA ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked at build time. Empty API/WS base => the browser talks to the SAME origin,
# and nginx (below) reverse-proxies /api and /ws to the backend (no CORS).
ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# --- Stage 2: serve the static build with nginx ---
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
