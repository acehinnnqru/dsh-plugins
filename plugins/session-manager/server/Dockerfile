# syntax=docker/dockerfile:1
#
# The directory server: one public WebSocket (`/v1/node`) that every node dials, the group state it
# keeps, and the bridge between node sockets. It runs as its own process, so it ships as its own
# image instead of riding the Host.
#
# The image carries the compiled bundle. The repository pins its TypeScript and bundler versions, so
# installing that toolchain inside the image would resolve a different tree; build first:
#   pnpm --filter session-manager-server build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# `ws` is the server's only production dependency. `--ignore-scripts` keeps npm from running the
# package's `prepare` build, which needs the toolchain this stage deliberately does not install.
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY lib/index.mjs ./lib/index.mjs
# A container's 127.0.0.1 is unreachable from outside, so the default config listens on every
# interface and keeps the group state on the volume. Mount over this file to change either.
COPY docker-config.json /etc/session-manager/config.json

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8787
VOLUME ["/data"]

ENTRYPOINT ["node", "lib/index.mjs"]
CMD ["--config", "/etc/session-manager/config.json"]
