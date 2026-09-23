# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.* ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:stable-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# The complete configuration below does not need image entrypoint templates.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
