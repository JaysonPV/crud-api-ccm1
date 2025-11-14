FROM node:20

# Installer Nginx et curl
RUN apt-get update && \
    apt-get install -y nginx curl && \
    rm -rf /var/lib/apt/lists/*

# Création répertoire app
WORKDIR /usr/src/app

# Copier package.json et installer dépendances
COPY package*.json ./
RUN npm install

# Copier le code source
COPY . .

# Créer le répertoire de logs avec les bonnes permissions
RUN mkdir -p /var/logs/crud && \
    chown -R node:node /var/logs/crud && \
    chmod -R 755 /var/logs/crud

# Donner les droits d'exécution à start.sh
RUN apk add --no-cache netcat-openbsd

RUN chmod +x start.sh

# Expose le port (sera remplacé par la variable PORT de Cloud Run)
EXPOSE 8080

# Healthcheck - utilise la variable PORT si définie, sinon 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-80}/health || exit 1

# Commande de démarrage
CMD ["/bin/bash", "./start.sh"]