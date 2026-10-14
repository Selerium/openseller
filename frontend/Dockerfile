FROM node:22-alpine

WORKDIR /app

# Installed before the source is copied so an edit to app code does not invalidate the
# dependency layer. Note this is only effective without a bind mount; see compose, which
# adds a node_modules volume for that reason.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

# `next start` needs a build first. Composing dev and prod into one image would bake either
# the dev server or a stale production build into the layer, so the mode is a command
# argument and the build runs at container start.
#   DEV=true  -> npm run dev   (hot reload through the bind mount)
#   DEV=false -> npm run build && npm run start
#
# DEV, not DOCKER_MODE: DOCKER_MODE answers "is the frontend in the compose stack", which is
# always true now, and keying the dev server off it served a development build under PROD=true.
CMD ["sh", "-c", "if [ \"$DEV\" = \"true\" ]; then exec npm run dev; else npm run build && exec npm run start; fi"]