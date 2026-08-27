# Base image estable para ARMv7
FROM node:20-bookworm-slim

# Instalamos dependencias del sistema necesarias
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./
# Copiamos la configuración de Sequelize
COPY .sequelizerc ./
# Copiamos las migraciones y config de sequelize (archivos .cjs)
COPY src/migrations ./src/migrations/
COPY src/config/sequelize-config.cjs ./src/config/
# Copiamos el código compilado
COPY dist ./dist/

# Instalamos dependencias de producción
RUN npm install --omit=dev

# Exponemos el puerto de la API
EXPOSE 3000

# Iniciamos el servidor (el comando 'start' ejecutará las migraciones automáticamente)
CMD ["npm", "start"]
