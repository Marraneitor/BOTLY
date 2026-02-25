FROM node:20-bookworm-slim

# Dependencias del sistema:
# - libs para que Chromium (de puppeteer) corra
# - python3 + pip para Flask
RUN apt-get update && apt-get install -y \
    ca-certificates \
    git \
    python3 \
    python3-venv \
    python3-pip \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dejar que puppeteer descargue Chromium durante npm install

# Instalar dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Instalar dependencias Python
COPY requirements.txt ./
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código
COPY . ./

# Directorio writable para auth de whatsapp-web.js
RUN mkdir -p /app/.wwebjs_auth && chmod -R 777 /app/.wwebjs_auth

EXPOSE 5000

CMD ["sh", "start_railway.sh"]
