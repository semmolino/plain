FROM node:20

WORKDIR /app

# Chromium system dependencies (required by playwright-chromium)
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libx11-6 libxcb1 libxext6 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Build frontend
COPY frontend-react/package*.json ./frontend-react/
RUN npm ci --prefix frontend-react
COPY frontend-react/ ./frontend-react/
RUN npm --prefix frontend-react run build

# Install backend + download Chromium browser binary
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend
RUN cd backend && npx playwright install chromium

COPY backend/ ./backend/

EXPOSE 3000
CMD ["node", "backend/server.js"]
