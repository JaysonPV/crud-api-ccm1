#!/bin/bash
set -e

echo "Démarrage du processus de migration..."

# Créer le fichier de credentials GCP
echo "$GCP_SA_KEY" > /tmp/gcp-key.json
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-key.json

echo "Démarrage de Cloud SQL Proxy..."
/usr/local/bin/cloud_sql_proxy \
    --credentials-file=/tmp/gcp-key.json \
    --address=0.0.0.0 \
    --port=3306 \
    "$DB_INSTANCE_CONNECTION_NAME" &

PROXY_PID=$!

# Attendre que le proxy soit prêt
echo "Attente du démarrage du proxy..."
sleep 10

# Vérifier que le proxy est démarré
if ! kill -0 $PROXY_PID 2>/dev/null; then
    echo "Cloud SQL Proxy n'a pas pu démarrer"
    exit 1
fi

echo "Cloud SQL Proxy démarré (PID: $PROXY_PID)"

# Exécuter les migrations
echo "🗄️  Exécution des migrations..."
node migrations/migrate.js

MIGRATION_EXIT_CODE=$?

# Arrêter le proxy
echo "Arrêt du proxy..."
kill $PROXY_PID
wait $PROXY_PID 2>/dev/null || true

# Nettoyer
rm -f /tmp/gcp-key.json

if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
    echo "Migrations terminées avec succès"
    exit 0
else
    echo "Les migrations ont échoué"
    exit $MIGRATION_EXIT_CODE
fi