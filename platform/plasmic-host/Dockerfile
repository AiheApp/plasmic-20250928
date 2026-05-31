FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY serve.json ./

# Install dependencies (force devDependencies: vite is a devDep and the build env
# may carry NODE_ENV=production, which would otherwise make npm skip them)
RUN npm install --include=dev

# Copy source files
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install serve globally
RUN npm install -g serve

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/serve.json ./dist/serve.json

# Expose port
EXPOSE 3000

# Serve the static files with config
CMD ["serve", "-s", "dist", "-l", "3000"]
