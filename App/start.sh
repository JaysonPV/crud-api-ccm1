#!/bin/bash
set -e

# Créer le répertoire logs si n'existe pas
mkdir -p /var/logs/crud

# Définir le port par défaut si non défini (pour compatibilité locale)
export PORT=${PORT:-80}

# Générer la configuration Nginx avec le bon port
cat > /etc/nginx/nginx.conf <<EOF
events {}

http {
    # Format JSON pour access.log
    log_format json_combined escape=json
        '{ "time":"\$time_iso8601", "remote_addr":"\$remote_addr", "method":"\$request_method", "uri":"\$uri", "status":"\$status", "user_agent":"\$http_user_agent", "response_time":"\$request_time" }';

    # Configuration des logs
    access_log /var/logs/crud/access.log json_combined;
    error_log /var/logs/crud/error.log warn;

    server {
        listen ${PORT};

        # Intercepter les erreurs et les logger en JSON dans access.log aussi
        error_page 404 = @not_found;
        error_page 500 502 503 504 = @server_error;

        location @not_found {
            access_log /var/logs/crud/access.log json_combined;
            error_log /var/logs/crud/error.log warn;
            add_header Content-Type application/json;
            return 404 '{"error":"Not Found","status":404}';
        }

        location @server_error {
            access_log /var/logs/crud/access.log json_combined;
            error_log /var/logs/crud/error.log warn;
            add_header Content-Type application/json;
            return 500 '{"error":"Internal Server Error","status":500}';
        }

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        }
    }
}
EOF

echo "Nginx configuré pour écouter sur le port ${PORT}"

# Lancer l'application Node en arrière-plan
echo "Démarrage de Node.js sur le port 3000..."
nohup node index.js > /var/logs/crud/app.log 2>&1 &

# Attendre que Node.js soit prêt
sleep 2

# Lancer Nginx au premier plan
echo "Démarrage de Nginx sur le port ${PORT}..."
nginx -g "daemon off;"