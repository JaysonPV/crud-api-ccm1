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
            access_log /var/logs/crud/access.log json_combined;
            error_log /var/logs/crud/error.log warn;
            add_header Content-Type application/json;
            return 404 '{"success":false,"error":"Not Found","status":404}';
        }

        location @server_error {
            access_log /var/logs/crud/access.log json_combined;
            error_log /var/logs/crud/error.log warn;
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

echo "✓ Nginx configuré pour le port ${PORT}"

# Démarrer Node.js en arrière-plan
echo "===== Démarrage Node.js ====="
node index.js > /var/logs/crud/app.log 2>&1 &
NODE_PID=$!
echo "✓ Node.js lancé (PID: $NODE_PID)"

# Attendre que Node.js réponde (max 60 secondes)
echo "⏳ Attente de Node.js..."
COUNTER=0
MAX_WAIT=60

while [ $COUNTER -lt $MAX_WAIT ]; do
    if curl -sf http://127.0.0.1:3000/healthz > /dev/null 2>&1; then
        echo "✅ Node.js est prêt après ${COUNTER}s"
        break
    fi
    
    # Vérifier si le processus Node est toujours en vie
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "❌ Node.js s'est arrêté"
        echo "Derniers logs:"
        tail -50 /var/logs/crud/app.log
        exit 1
    fi
    
    sleep 1
    COUNTER=$((COUNTER + 1))
    
    # Afficher un message tous les 10s
    if [ $((COUNTER % 10)) -eq 0 ]; then
        echo "   Toujours en attente... (${COUNTER}s/${MAX_WAIT}s)"
    fi
done

# Timeout check
if [ $COUNTER -eq $MAX_WAIT ]; then
    echo "❌ Timeout après ${MAX_WAIT}s"
    echo "Logs de Node.js:"
    cat /var/logs/crud/app.log
    exit 1
fi

# Démarrer Nginx au premier plan
echo "===== Démarrage Nginx ====="
echo "🚀 Nginx sur le port ${PORT}"
exec nginx -g "daemon off;"