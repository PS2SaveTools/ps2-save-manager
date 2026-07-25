FROM node:22-alpine AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY packages/app/package.json packages/app/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci

FROM dependencies AS dev

CMD ["/bin/sh", "-lc", "npm ci && npm run app:dev"]

FROM dependencies AS source

COPY . .

FROM source AS test

RUN npm test

FROM test AS build

RUN npm run app:build

FROM nginx:alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/PS2SaveTools/ps2-save-manager"
LABEL org.opencontainers.image.description="Browser-based PS2 save file manager"
LABEL org.opencontainers.image.licenses="MIT"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/start-ps2-save-manager.sh /usr/local/bin/start-ps2-save-manager
COPY --from=build /workspace/packages/app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --output-document=/dev/null http://127.0.0.1/healthz || exit 1

CMD ["/usr/local/bin/start-ps2-save-manager"]
