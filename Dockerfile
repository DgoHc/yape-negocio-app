# Etapa 1: Construcción
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Instalar herramientas necesarias para Prisma
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

# Limpieza forzada de archivos legacy antes de compilar
RUN rm -rf src/seeders/initial-seed.ts src/utils/check-db.ts

# Generar el cliente de Prisma y compilar TypeScript
RUN npx prisma generate
RUN npm run build

# Etapa 2: Producción
FROM node:20-bookworm-slim

WORKDIR /app

# Instalar runtime de OpenSSL necesario para Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Exponer el puerto
EXPOSE 3000

# Variables de entorno por defecto (se pueden sobrescribir en docker-compose)
ENV NODE_ENV=production

# Ejecutar el servidor
CMD ["node", "dist/server.js"]
