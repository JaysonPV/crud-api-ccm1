const mysql = require('mysql2/promise');

const dbConfig = {
    host: '127.0.0.1',  // Via Cloud SQL Proxy
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

async function runMigrations() {
    let connection;
    
    try {
        console.log('Connexion à la base de données...');
        connection = await mysql.createConnection(dbConfig);
        console.log('Connexion établie');

        // Migration 1: Créer la table users si elle n'existe pas
        console.log('Exécution de la migration: création de la table users');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                uuid VARCHAR(36) PRIMARY KEY,
                fullname VARCHAR(255) NOT NULL,
                study_level VARCHAR(255) NOT NULL,
                age INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_created_at (created_at),
                INDEX idx_fullname (fullname)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✓ Table users créée/vérifiée');

        // Migration 2: Créer une table de suivi des migrations
        console.log('Exécution de la migration: table de suivi des migrations');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                version VARCHAR(50) NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                description TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✓ Table schema_migrations créée/vérifiée');

        // Enregistrer cette migration
        const migrationVersion = 'v1.0.0_initial';
        await connection.execute(
            `INSERT IGNORE INTO schema_migrations (version, description) VALUES (?, ?)`,
            [migrationVersion, 'Initial schema: users table with indexes']
        );
        console.log(`✓ Migration ${migrationVersion} enregistrée`);

        // Vérifier l'état de la base
        const [tables] = await connection.execute(`SHOW TABLES`);
        console.log('\nTables présentes dans la base:');
        tables.forEach(table => console.log('  -', Object.values(table)[0]));

        const [users] = await connection.execute('SELECT COUNT(*) as count FROM users');
        console.log(`\nNombre d'utilisateurs: ${users[0].count}`);

        console.log('\n✅ Toutes les migrations ont été exécutées avec succès');
        
    } catch (error) {
        console.error('❌ Erreur lors des migrations:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Connexion fermée');
        }
    }
}

// Attendre quelques secondes pour que Cloud SQL Proxy soit prêt
setTimeout(runMigrations, 5000);