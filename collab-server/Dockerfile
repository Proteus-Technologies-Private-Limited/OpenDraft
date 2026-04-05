FROM node:20-slim

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Create data directory for SQLite + Yjs documents
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

EXPOSE 8080

CMD ["node", "dist/server.js"]
