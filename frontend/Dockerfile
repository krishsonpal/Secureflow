# SecureFlow dashboard (Vite build served by nginx).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Both API URL vars are baked at build time (Vite replaces import.meta.env.* at build).
# VITE_API_BASE_URL  — used by Dashboard, Settings, ThreatAnalysis, useLiveTraffic, orgApi, analyticsApi
# VITE_API_URL       — used by AuthContext (includes /api/v1 suffix)
# Set both to your deployed backend URL when building for production.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
