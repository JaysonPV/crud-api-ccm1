const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

const dbConfig = {
	host: process.env.DB_HOST || '127.0.0.1',
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	database: process.env.DB_NAME || 'crud_app'
};

const LOG_DIR = '/tmp/logs/crud';
const APP_LOG_FILE = path.join(LOG_DIR, 'app.log');

let pool;
let dbInitialized = false;

async function log(level, message, context = {}, processingTime = null) {
	const timestamp = new Date().toISOString();
	const logEntry = {
		timestamp,
		level,
		message,
		context,
		...(processingTime !== null && { processing_time_ms: processingTime })
	};

	const logLine = JSON.stringify(logEntry) + '\n';

	try {
		await fs.mkdir(LOG_DIR, { recursive: true });
		await fs.appendFile(APP_LOG_FILE, logLine);
		console.log(`[${level}] ${message}`, JSON.stringify(context));
	} catch (error) {
		console.error('Erreur lors de l\'écriture du log:', error);
	}
}

app.use((req, res, next) => {
	req.startTime = Date.now();
	next();
});

async function initDatabase() {
	try {
		await log('INFO', 'Tentative de connexion à la base de données', { 
			config: { host: dbConfig.host, database: dbConfig.database } 
		});
		
		pool = mysql.createPool({
			...dbConfig,
			waitForConnections: true,
			connectionLimit: 10,
			queueLimit: 0
		});
		
		// Test de connexion
		await pool.execute('SELECT 1');

		// Créer la table si elle n'existe pas
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS users (
				uuid VARCHAR(36) PRIMARY KEY,
				fullname VARCHAR(255) NOT NULL,
				study_level VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
			)
		`);

		dbInitialized = true;
		await log('INFO', 'Base de données initialisée avec succès', { table: 'users' });
		return true;
	} catch (error) {
		await log('ERROR', 'Erreur lors de l\'initialisation de la base de données', { 
			error: error.message,
			code: error.code 
		});
		return false;
	}
}

function validateUser(userData) {
	const { fullname, study_level, age } = userData;
	const errors = [];

	if (!fullname || typeof fullname !== 'string' || fullname.trim() === '') {
		errors.push('fullname est requis et doit être une chaîne non vide');
	}

	if (!study_level || typeof study_level !== 'string' || study_level.trim() === '') {
		errors.push('study_level est requis et doit être une chaîne non vide');
	}

	if (age === undefined || age === null) {
		errors.push('age est requis');
	} else if (typeof age !== 'number' || !Number.isInteger(age)) {
		errors.push('age doit être un nombre entier');
	} else if (age < 0 || age > 150) {
		errors.push('age doit être entre 0 et 150');
	}

	return {
		isValid: errors.length === 0,
		errors
	};
}

// HEALTH CHECK - DOIT REPONDRE RAPIDEMENT
app.get('/health', async (req, res) => {
	// Toujours répondre 200 si l'API est up
	if (!dbInitialized || !pool) {
		return res.status(200).json({
			success: true,
			status: 'initializing',
			message: 'API is up, database initializing'
		});
	}

	try {
		// Test rapide de la DB avec timeout
		await Promise.race([
			pool.execute('SELECT 1'),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
		]);

		res.status(200).json({
			success: true,
			status: 'healthy',
			database: 'connected'
		});
	} catch (error) {
		// Même en cas d'erreur DB, on répond 200 pour que le conteneur démarre
		res.status(200).json({
			success: true,
			status: 'degraded',
			database: 'unavailable',
			message: 'API is up but database connection failed'
		});
	}
});

app.get('/api/users', async (req, res) => {
	if (!dbInitialized) {
		return res.status(503).json({ success: false, error: 'Database not ready' });
	}

	const startTime = Date.now();
	const delay = parseInt(req.query.delay) || 0;
	
	try {
		await log('INFO', 'Récupération de la liste des utilisateurs', { 
			endpoint: '/api/users',
			method: 'GET',
			delay
		});

		if (delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		const [rows] = await pool.execute('SELECT * FROM users ORDER BY created_at DESC');
		const processingTime = Date.now() - startTime;
		
		await log('INFO', 'Liste des utilisateurs récupérée avec succès', { 
			endpoint: '/api/users',
			method: 'GET',
			count: rows.length
		}, processingTime);

		res.status(200).json({
			success: true,
			count: rows.length,
			data: rows
		});
	} catch (error) {
		const processingTime = Date.now() - startTime;
		
		await log('ERROR', 'Erreur lors de la récupération des utilisateurs', { 
			endpoint: '/api/users',
			method: 'GET',
			error: error.message,
			code: error.code
		}, processingTime);

		res.status(500).json({ 
			success: false,
			error: 'Erreur serveur lors de la récupération des utilisateurs' 
		});
	}
});

app.get('/api/users/:uuid', async (req, res) => {
	if (!dbInitialized) {
		return res.status(503).json({ success: false, error: 'Database not ready' });
	}

	const startTime = Date.now();
	const { uuid } = req.params;
	const delay = parseInt(req.query.delay) || 0;
	
	try {
		await log('INFO', 'Récupération d\'un utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'GET',
			uuid,
			delay
		});

		if (delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		const [rows] = await pool.execute('SELECT * FROM users WHERE uuid = ?', [uuid]);

		if (rows.length === 0) {
			const processingTime = Date.now() - startTime;
			
			await log('WARN', 'Utilisateur non trouvé', { 
				endpoint: '/api/users/:uuid',
				method: 'GET',
				uuid,
				status: 404
			}, processingTime);

			return res.status(404).json({ 
				success: false,
				error: 'Utilisateur non trouvé' 
			});
		}

		const processingTime = Date.now() - startTime;
		
		await log('INFO', 'Utilisateur récupéré avec succès', { 
			endpoint: '/api/users/:uuid',
			method: 'GET',
			uuid
		}, processingTime);

		res.status(200).json({
			success: true,
			data: rows[0]
		});
	} catch (error) {
		const processingTime = Date.now() - startTime;
		
		await log('ERROR', 'Erreur lors de la récupération de l\'utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'GET',
			uuid,
			error: error.message,
			code: error.code
		}, processingTime);

		res.status(500).json({ 
			success: false,
			error: 'Erreur serveur lors de la récupération de l\'utilisateur' 
		});
	}
});

app.post('/api/users', async (req, res) => {
	if (!dbInitialized) {
		return res.status(503).json({ success: false, error: 'Database not ready' });
	}

	const startTime = Date.now();
	const delay = parseInt(req.query.delay) || 0;
	
	try {
		const { fullname, study_level, age } = req.body;

		await log('INFO', 'Tentative de création d\'un utilisateur', { 
			endpoint: '/api/users',
			method: 'POST',
			data: { fullname, study_level, age },
			delay
		});

		if (delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		const validation = validateUser(req.body);
		if (!validation.isValid) {
			const processingTime = Date.now() - startTime;
			
			await log('WARN', 'Validation échouée lors de la création', { 
				endpoint: '/api/users',
				method: 'POST',
				errors: validation.errors,
				status: 400
			}, processingTime);

			return res.status(400).json({ 
				success: false,
				error: 'Données invalides',
				details: validation.errors
			});
		}

		const uuid = uuidv4();

		await pool.execute(
			'INSERT INTO users (uuid, fullname, study_level, age) VALUES (?, ?, ?, ?)',
			[uuid, fullname, study_level, age]
		);

		const newUser = { uuid, fullname, study_level, age };
		const processingTime = Date.now() - startTime;
		
		await log('INFO', 'Utilisateur créé avec succès', { 
			endpoint: '/api/users',
			method: 'POST',
			uuid
		}, processingTime);

		res.status(201).json({
			success: true,
			message: 'Utilisateur créé avec succès',
			data: newUser
		});
	} catch (error) {
		const processingTime = Date.now() - startTime;
		
		await log('ERROR', 'Erreur lors de la création de l\'utilisateur', { 
			endpoint: '/api/users',
			method: 'POST',
			error: error.message,
			code: error.code
		}, processingTime);

		res.status(500).json({ 
			success: false,
			error: 'Erreur serveur lors de la création de l\'utilisateur' 
		});
	}
});

app.put('/api/users/:uuid', async (req, res) => {
	if (!dbInitialized) {
		return res.status(503).json({ success: false, error: 'Database not ready' });
	}

	const startTime = Date.now();
	const { uuid } = req.params;
	const delay = parseInt(req.query.delay) || 0;
	
	try {
		const { fullname, study_level, age } = req.body;

		await log('INFO', 'Tentative de mise à jour d\'un utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'PUT',
			uuid,
			data: { fullname, study_level, age },
			delay
		});

		if (delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		const validation = validateUser(req.body);
		if (!validation.isValid) {
			const processingTime = Date.now() - startTime;
			
			await log('WARN', 'Validation échouée lors de la mise à jour', { 
				endpoint: '/api/users/:uuid',
				method: 'PUT',
				uuid,
				errors: validation.errors,
				status: 400
			}, processingTime);

			return res.status(400).json({ 
				success: false,
				error: 'Données invalides',
				details: validation.errors
			});
		}

		const [checkRows] = await pool.execute('SELECT uuid FROM users WHERE uuid = ?', [uuid]);
		
		if (checkRows.length === 0) {
			const processingTime = Date.now() - startTime;
			
			await log('WARN', 'Utilisateur non trouvé lors de la mise à jour', { 
				endpoint: '/api/users/:uuid',
				method: 'PUT',
				uuid,
				status: 404
			}, processingTime);

			return res.status(404).json({ 
				success: false,
				error: 'Utilisateur non trouvé' 
			});
		}

		await pool.execute(
			'UPDATE users SET fullname = ?, study_level = ?, age = ? WHERE uuid = ?',
			[fullname, study_level, age, uuid]
		);

		const updatedUser = { uuid, fullname, study_level, age };
		const processingTime = Date.now() - startTime;
		
		await log('INFO', 'Utilisateur mis à jour avec succès', { 
			endpoint: '/api/users/:uuid',
			method: 'PUT',
			uuid
		}, processingTime);

		res.status(200).json({
			success: true,
			message: 'Utilisateur mis à jour avec succès',
			data: updatedUser
		});
	} catch (error) {
		const processingTime = Date.now() - startTime;
		
		await log('ERROR', 'Erreur lors de la mise à jour de l\'utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'PUT',
			uuid,
			error: error.message,
			code: error.code
		}, processingTime);

		res.status(500).json({ 
			success: false,
			error: 'Erreur serveur lors de la mise à jour de l\'utilisateur' 
		});
	}
});

app.delete('/api/users/:uuid', async (req, res) => {
	if (!dbInitialized) {
		return res.status(503).json({ success: false, error: 'Database not ready' });
	}

	const startTime = Date.now();
	const { uuid } = req.params;
	const delay = parseInt(req.query.delay) || 0;
	
	try {
		await log('INFO', 'Tentative de suppression d\'un utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'DELETE',
			uuid,
			delay
		});

		if (delay > 0) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		const [result] = await pool.execute('DELETE FROM users WHERE uuid = ?', [uuid]);

		if (result.affectedRows === 0) {
			const processingTime = Date.now() - startTime;
			
			await log('WARN', 'Utilisateur non trouvé lors de la suppression', { 
				endpoint: '/api/users/:uuid',
				method: 'DELETE',
				uuid,
				status: 404
			}, processingTime);

			return res.status(404).json({ 
				success: false,
				error: 'Utilisateur non trouvé' 
			});
		}

		const processingTime = Date.now() - startTime;
		
		await log('INFO', 'Utilisateur supprimé avec succès', { 
			endpoint: '/api/users/:uuid',
			method: 'DELETE',
			uuid
		}, processingTime);

		res.status(200).json({ 
			success: true,
			message: 'Utilisateur supprimé avec succès' 
		});
	} catch (error) {
		const processingTime = Date.now() - startTime;
		
		await log('ERROR', 'Erreur lors de la suppression de l\'utilisateur', { 
			endpoint: '/api/users/:uuid',
			method: 'DELETE',
			uuid,
			error: error.message,
			code: error.code
		}, processingTime);

		res.status(500).json({ 
			success: false,
			error: 'Erreur serveur lors de la suppression de l\'utilisateur' 
		});
	}
});

app.use((req, res) => {
	log('WARN', 'Route non trouvée', { 
		endpoint: req.path,
		method: req.method,
		status: 404
	});

	res.status(404).json({ 
		success: false,
		error: 'Route non trouvée' 
	});
});

// Démarrer le serveur AVANT d'initialiser la DB
const server = app.listen(PORT, async () => {
	console.log(`✅ Serveur HTTP démarré sur le port ${PORT}`);
	console.log(`📍 Health check: http://localhost:${PORT}/health`);
	console.log(`📍 API Users: http://localhost:${PORT}/api/users`);
	
	// Initialiser la DB après que le serveur soit up
	console.log('🔄 Initialisation de la base de données...');
	const success = await initDatabase();
	
	if (success) {
		console.log('✅ Base de données connectée');
	} else {
		console.warn('⚠️  Base de données non disponible, retry dans 10s...');
		// Retry après 10 secondes
		setTimeout(async () => {
			await initDatabase();
		}, 10000);
	}
});

process.on('SIGTERM', async () => {
	console.log('📡 Signal SIGTERM reçu, arrêt gracieux...');
	await log('INFO', 'Signal SIGTERM reçu, arrêt de l\'application');
	
	server.close(() => {
		console.log('✅ Serveur HTTP fermé');
	});
	
	if (pool) {
		await pool.end();
		console.log('✅ Connexion DB fermée');
	}
	process.exit(0);
});

process.on('SIGINT', async () => {
	console.log('📡 Signal SIGINT reçu, arrêt gracieux...');
	await log('INFO', 'Signal SIGINT reçu, arrêt de l\'application');
	
	server.close(() => {
		console.log('✅ Serveur HTTP fermé');
	});
	
	if (pool) {
		await pool.end();
		console.log('✅ Connexion DB fermée');
	}
	process.exit(0);
});