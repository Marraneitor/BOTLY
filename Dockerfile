FROM node:20-slim

# Baileys needs no browser — just minimal dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (for better cache)
COPY whatsapp-bot-saas/package*.json ./

RUN npm install --production

# Copy app code
COPY whatsapp-bot-saas/ ./

# Create writable directories for Baileys auth sessions
RUN mkdir -p /app/.baileys_auth && chmod -R 777 /app/.baileys_auth

EXPOSE 3000

CMD ["node", "server.js"]
