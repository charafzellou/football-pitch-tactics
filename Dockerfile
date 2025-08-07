#######################################
FROM oven/bun:1.2.19-alpine AS builder

# Set app workdir
WORKDIR /app

# Copy frontend folders to the container
COPY ./frontend /app

# # Install Python for node-gyp (otherwise the build fails)
# RUN apk add --no-cache python3 make g++ \
#     && ln -sf python3 /usr/bin/python

# Use Bun to install dependencies, then build
RUN bun install

# RUN NODE_OPTIONS="--max-old-space-size=8192" bun run build
RUN bun run build

#######################################
FROM oven/bun:1.2.19-alpine AS runner

# Add and set a non-root user
RUN addgroup -S nuxt && adduser -S nuxt -G nuxt
USER nuxt

# # Set app workdir
WORKDIR /app

# # Copy the frontend from the builder container
COPY --from=builder /app/.output /app/.output

# Expose the frontend port
EXPOSE 8080

# # Run the frontend server
CMD [ "bun", ".output/server/index.mjs" ]