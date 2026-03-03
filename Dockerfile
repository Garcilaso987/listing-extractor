FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

# Copiamos package.json y package-lock si existe
COPY package*.json ./

RUN npm install

# Copiamos el resto del proyecto
COPY . .

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]
