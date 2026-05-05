FROM node:20

WORKDIR /app

# Build frontend
COPY frontend-react/package*.json ./frontend-react/
RUN npm ci --prefix frontend-react
COPY frontend-react/ ./frontend-react/
RUN npm --prefix frontend-react run build

# Install backend
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend

COPY backend/ ./backend/

EXPOSE 3000
CMD ["node", "backend/server.js"]
