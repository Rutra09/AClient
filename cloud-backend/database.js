const path = require('path');

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
let db;

if (DB_TYPE === 'postgres') {
    // PostgreSQL connection
    const { Pool } = require('pg');
    
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });

    pool.on('connect', () => {
        console.log('Connected to PostgreSQL database');
    });

    pool.on('error', (err) => {
        console.error('Unexpected error on idle client', err);
    });

    // Wrapper to make PostgreSQL work with SQLite-like syntax
    db = {
        run: async (query, params, callback) => {
            try {
                // Convert SQLite syntax to PostgreSQL
                query = query.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
                query = query.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
                query = query.replace(/datetime\('now'\)/g, "NOW()");
                query = query.replace(/datetime\("now"\)/g, "NOW()");
                
                const result = await pool.query(query, params || []);
                if (callback) {
                    callback.call({ lastID: result.rows[0]?.id, changes: result.rowCount }, null);
                }
                return result;
            } catch (err) {
                if (callback) callback.call({ lastID: 0, changes: 0 }, err);
                else console.error('Query error:', err);
            }
        },
        get: async (query, params, callback) => {
            try {
                query = query.replace(/datetime\('now'\)/g, "NOW()");
                query = query.replace(/datetime\("now"\)/g, "NOW()");
                const result = await pool.query(query, params || []);
                if (callback) callback(null, result.rows[0]);
                return result.rows[0];
            } catch (err) {
                if (callback) callback(err, null);
                else console.error('Query error:', err);
            }
        },
        all: async (query, params, callback) => {
            try {
                query = query.replace(/datetime\('now'\)/g, "NOW()");
                query = query.replace(/datetime\("now"\)/g, "NOW()");
                const result = await pool.query(query, params || []);
                if (callback) callback(null, result.rows);
                return result.rows;
            } catch (err) {
                if (callback) callback(err, []);
                else console.error('Query error:', err);
            }
        },
        serialize: (callback) => {
            // PostgreSQL doesn't need serialization, just run the callback
            if (callback) callback();
        }
    };

    initDb();

} else {
    // SQLite connection (default)
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.DB_PATH ? path.resolve(__dirname, process.env.DB_PATH) : path.resolve(__dirname, 'cloud.db');

    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error opening database', err.message);
        } else {
            console.log('Connected to the SQLite database.');
            initDb();
        }
    });
}

function initDb() {
    db.serialize(() => {
        // Users table with role
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Settings table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            user_id INTEGER PRIMARY KEY,
            data TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Assets table with version tracking
        db.run(`CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            local_path TEXT,
            path TEXT NOT NULL,
            size INTEGER,
            version INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Create index for efficient version queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_assets_user_file 
                ON assets(user_id, filename, version DESC)`);

        // User limits table
        db.run(`CREATE TABLE IF NOT EXISTS user_limits (
            user_id INTEGER PRIMARY KEY,
            max_versions INTEGER DEFAULT 3,
            max_storage_mb INTEGER DEFAULT 100,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Activity log table for admin monitoring
        db.run(`CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Password reset tokens table
        db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_by INTEGER,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (created_by) REFERENCES users (id)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_reset_tokens 
                ON password_reset_tokens(token, used, expires_at)`);

        console.log('Database tables initialized with roles and activity logging');
    });
}

module.exports = db;
