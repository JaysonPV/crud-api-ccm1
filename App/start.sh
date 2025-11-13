#!/bin/bash
set -e

# Créer les répertoires logs
mkdir -p /var/logs/crud
mkdir -p /tmp/logs/crud

# Définir le port par défaut si non défini
export PORT=${PORT:-8080}
export NODE_PORT=3000

echo "Configuration: PORT=${PORT}, NODE_PORT=${NODE_PORT}"

# Générer la configuration Nginx avec le bon port
cat > /etc/nginx/nginx.conf <<EOF
events {
    worker_connections 1024;
}

http {
    # Format JSON pour access.log
    log_format json_combined escape=json
        '{ "time":"\$time_iso8601", "remote_addr":"\$remote_addr", "method":"\$request_method", "uri":"\$uri", "status":"\$status", "user_agent":"\$http_user_agent", "response_time":"\$request_time" }';

    # Configuration des logs
    access_log /var/logs/crud/access.log json_combined;
    error_log /var/logs/crud/error.log warn;

    # Timeout plus long pour le health check
    proxy_connect_timeout 30s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    server {
        listen ${PORT};
        server_name _;

        # Intercepter les erreurs
        error_page 404 = @not_found;
        error_page 500 502 503 504 = @server_error;

        location @not_found {
            add_header Content-Type application/json;
            return 404 '{"success":false,"error":"Not Found","status":404}';
        }

        location @server_error {
            add_header Content-Type application/json;
            return 500 '{"success":false,"error":"Internal Server Error","status":500}';
        }

        # Proxy vers Node.js
        location / {
            proxy_pass http://127.0.0.1:${NODE_PORT};
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            
            # Timeouts
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }
    }
}
EOF

echo "✅ Nginx configuré pour écouter sur le port ${PORT}"

# Lancer l'application Node.js en arrière-plan
echo "🚀 Démarrage de Node.js sur le port ${NODE_PORT}..."
node index.js &
NODE_PID=$!

echo "⏳ Attente du démarrage de Node.js (PID: ${NODE_PID})..."

# Attendre que Node.js soit prêt (max 30 secondes)
MAX_WAIT=30
COUNTER=0
while [ $COUNTER -lt $MAX_WAIT ]; do
    if curl -s http://127.0.0.1:${NODE_PORT}/health > /dev/null 2>&1; then
        echo "✅ Node.js est prêt !"
        break
    fi
    echo "⏳ Attente... ($COUNTER/$MAX_WAIT)"
    sleep 1
    COUNTER=$((COUNTER + 1))
    
    # Vérifier que Node.js tourne toujours
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "❌ Node.js s'est arrêté prématurément"
        exit 1
    fi
done

if [ $COUNTER -eq $MAX_WAIT ]; then
    echo "❌ Timeout: Node.js n'a pas démarré dans les temps"
    exit 1
fi

# Lancer Nginx au premier plan
echo "🌐 Démarrage de Nginx sur le port ${PORT}..."
exec nginx -g "daemon off;"
