const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_db';
const client = new MongoClient(uri);

let database;
let collections = {};

async function connect() {
    try {
        await client.connect();
        database = client.db();
        
        // Initialize collections
        collections.users = database.collection('users');
        collections.settings = database.collection('settings');
        collections.assets = database.collection('assets');
        collections.user_limits = database.collection('user_limits');
        collections.activity_log = database.collection('activity_log');
        collections.password_reset_tokens = database.collection('password_reset_tokens');
        
        // Create indexes
        await collections.users.createIndex({ username: 1 }, { unique: true });
        await collections.assets.createIndex({ user_id: 1, filename: 1, version: -1 });
        await collections.password_reset_tokens.createIndex({ token: 1, used: 1, expires_at: 1 });
        
        console.log('Connected to MongoDB database');
        return database;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

// Wrapper to make MongoDB work with SQLite-like syntax
const db = {
    run: async (query, params, callback) => {
        try {
            // Parse basic SQL-like operations
            if (query.includes('INSERT INTO users')) {
                const [username, password_hash] = params;
                const result = await collections.users.insertOne({
                    username,
                    password_hash,
                    role: 'user',
                    created_at: new Date()
                });
                if (callback) callback.call({ lastID: result.insertedId.toString(), changes: 1 }, null);
            }
            else if (query.includes('INSERT INTO settings')) {
                const [user_id, data] = params;
                await collections.settings.updateOne(
                    { user_id },
                    { $set: { data, updated_at: new Date() } },
                    { upsert: true }
                );
                if (callback) callback.call({ changes: 1 }, null);
            }
            else if (query.includes('INSERT INTO assets')) {
                const [user_id, filename, local_path, path, size, version] = params;
                const result = await collections.assets.insertOne({
                    user_id, filename, local_path, path, size, version,
                    created_at: new Date()
                });
                if (callback) callback.call({ lastID: result.insertedId.toString(), changes: 1 }, null);
            }
            else if (query.includes('INSERT INTO user_limits')) {
                const [user_id, max_versions, max_storage_mb] = params;
                await collections.user_limits.updateOne(
                    { user_id },
                    { $set: { max_versions, max_storage_mb } },
                    { upsert: true }
                );
                if (callback) callback.call({ changes: 1 }, null);
            }
            else if (query.includes('INSERT INTO activity_log')) {
                const values = params;
                await collections.activity_log.insertOne({
                    user_id: values[0],
                    action: values[1],
                    details: values[2] || null,
                    ip_address: values[3] || null,
                    created_at: new Date()
                });
                if (callback) callback.call({ changes: 1 }, null);
            }
            else if (query.includes('INSERT INTO password_reset_tokens')) {
                const [user_id, token, created_by, expires_at] = params;
                await collections.password_reset_tokens.insertOne({
                    user_id, token, created_by,
                    used: 0,
                    expires_at: new Date(expires_at),
                    created_at: new Date()
                });
                if (callback) callback.call({ changes: 1 }, null);
            }
            else if (query.includes('UPDATE users SET role')) {
                const [role, id] = params;
                const result = await collections.users.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                if (callback) callback.call({ changes: result.modifiedCount }, null);
            }
            else if (query.includes('UPDATE users SET password_hash')) {
                const [password_hash, id] = params;
                const result = await collections.users.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { password_hash } }
                );
                if (callback) callback.call({ changes: result.modifiedCount }, null);
            }
            else if (query.includes('UPDATE password_reset_tokens SET used')) {
                const [token] = params;
                const result = await collections.password_reset_tokens.updateOne(
                    { token },
                    { $set: { used: 1 } }
                );
                if (callback) callback.call({ changes: result.modifiedCount }, null);
            }
            else if (query.includes('UPDATE user_limits')) {
                const [max_versions, max_storage_mb, user_id] = params;
                const result = await collections.user_limits.updateOne(
                    { user_id },
                    { $set: { max_versions, max_storage_mb } },
                    { upsert: true }
                );
                if (callback) callback.call({ changes: result.modifiedCount }, null);
            }
            else if (query.includes('DELETE FROM assets WHERE id')) {
                const [id] = params;
                const result = await collections.assets.deleteOne({ _id: new ObjectId(id) });
                if (callback) callback.call({ changes: result.deletedCount }, null);
            }
            else {
                console.warn('Unhandled MongoDB run query:', query);
                if (callback) callback(null);
            }
        } catch (err) {
            console.error('MongoDB run error:', err);
            if (callback) callback(err);
        }
    },
    
    get: async (query, params, callback) => {
        try {
            let result = null;
            
            if (query.includes('SELECT * FROM users WHERE username')) {
                result = await collections.users.findOne({ username: params[0] });
                if (result) result.id = result._id.toString();
            }
            else if (query.includes('SELECT id, username FROM users WHERE id')) {
                result = await collections.users.findOne({ _id: new ObjectId(params[0]) }, { projection: { username: 1 } });
                if (result) result.id = result._id.toString();
            }
            else if (query.includes('SELECT id, username, role FROM users WHERE username')) {
                result = await collections.users.findOne({ username: params[0] });
                if (result) result.id = result._id.toString();
            }
            else if (query.includes('FROM user_limits WHERE user_id')) {
                result = await collections.user_limits.findOne({ user_id: params[0] });
            }
            else if (query.includes('FROM settings WHERE user_id')) {
                result = await collections.settings.findOne({ user_id: params[0] });
            }
            else if (query.includes('FROM password_reset_tokens') && query.includes('WHERE token')) {
                const tokenQuery = {
                    token: params[0],
                    used: 0,
                    expires_at: { $gt: new Date() }
                };
                result = await collections.password_reset_tokens.findOne(tokenQuery);
                if (result && query.includes('JOIN users')) {
                    const user = await collections.users.findOne({ _id: new ObjectId(result.user_id) });
                    if (user) result.username = user.username;
                }
            }
            else if (query.includes('MAX(version) as max_version FROM assets')) {
                const [user_id, filename] = params;
                const asset = await collections.assets.findOne(
                    { user_id, filename },
                    { sort: { version: -1 } }
                );
                result = { max_version: asset ? asset.version : null };
            }
            else if (query.includes('FROM assets WHERE') && query.includes('ORDER BY version DESC LIMIT 1')) {
                const user_id = params[0];
                const filename = params[1];
                result = await collections.assets.findOne(
                    { user_id, filename },
                    { sort: { version: -1 } }
                );
            }
            else if (query.includes('COUNT(*) as count FROM users')) {
                const count = await collections.users.countDocuments();
                result = { count };
            }
            else if (query.includes('COUNT(*) as count') && query.includes('FROM assets')) {
                const count = await collections.assets.countDocuments();
                const sizeResult = await collections.assets.aggregate([
                    { $group: { _id: null, total_size: { $sum: '$size' } } }
                ]).toArray();
                result = { count, total_size: sizeResult[0]?.total_size || 0 };
            }
            else if (query.includes('COUNT(*) as count FROM activity_log')) {
                const count = await collections.activity_log.countDocuments({
                    created_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                });
                result = { count };
            }
            
            if (callback) callback(null, result);
            return result;
        } catch (err) {
            console.error('MongoDB get error:', err);
            if (callback) callback(err, null);
        }
    },
    
    all: async (query, params, callback) => {
        try {
            let results = [];
            
            if (query.includes('SELECT filename') && query.includes('GROUP BY filename')) {
                const user_id = params[0];
                results = await collections.assets.aggregate([
                    { $match: { user_id } },
                    { $sort: { version: -1 } },
                    { $group: {
                        _id: '$filename',
                        filename: { $first: '$filename' },
                        local_path: { $first: '$local_path' },
                        latest_version: { $max: '$version' },
                        version_count: { $sum: 1 },
                        total_size: { $sum: '$size' },
                        last_updated: { $max: '$created_at' }
                    }},
                    { $sort: { last_updated: -1 } }
                ]).toArray();
            }
            else if (query.includes('FROM assets WHERE user_id') && query.includes('ORDER BY version DESC')) {
                const [user_id, filename] = params;
                results = await collections.assets.find({ user_id, filename })
                    .sort({ version: -1 })
                    .toArray();
            }
            else if (query.includes('FROM users') && query.includes('LEFT JOIN user_limits')) {
                results = await collections.users.aggregate([
                    {
                        $lookup: {
                            from: 'user_limits',
                            localField: '_id',
                            foreignField: 'user_id',
                            as: 'limits'
                        }
                    },
                    {
                        $lookup: {
                            from: 'assets',
                            localField: '_id',
                            foreignField: 'user_id',
                            as: 'assets'
                        }
                    },
                    {
                        $project: {
                            id: { $toString: '$_id' },
                            username: 1,
                            role: 1,
                            created_at: 1,
                            max_versions: { $arrayElemAt: ['$limits.max_versions', 0] },
                            max_storage_mb: { $arrayElemAt: ['$limits.max_storage_mb', 0] },
                            file_count: { $size: { $setUnion: ['$assets.filename', []] } },
                            total_size: { $sum: '$assets.size' }
                        }
                    },
                    { $sort: { created_at: -1 } }
                ]).toArray();
            }
            else if (query.includes('FROM activity_log')) {
                const limit = params[0] || 50;
                results = await collections.activity_log.aggregate([
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'user_id',
                            foreignField: '_id',
                            as: 'user'
                        }
                    },
                    {
                        $project: {
                            created_at: 1,
                            action: 1,
                            details: 1,
                            ip_address: 1,
                            username: { $arrayElemAt: ['$user.username', 0] }
                        }
                    },
                    { $sort: { created_at: -1 } },
                    { $limit: limit }
                ]).toArray();
            }
            else if (query.includes('FROM password_reset_tokens')) {
                const user_id = params[0];
                results = await collections.password_reset_tokens.aggregate([
                    {
                        $match: {
                            user_id,
                            used: 0,
                            expires_at: { $gt: new Date() }
                        }
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'created_by',
                            foreignField: '_id',
                            as: 'creator'
                        }
                    },
                    {
                        $project: {
                            token: 1,
                            created_at: 1,
                            expires_at: 1,
                            created_by_username: { $arrayElemAt: ['$creator.username', 0] }
                        }
                    },
                    { $sort: { created_at: -1 } }
                ]).toArray();
            }
            
            if (callback) callback(null, results);
            return results;
        } catch (err) {
            console.error('MongoDB all error:', err);
            if (callback) callback(err, []);
        }
    },
    
    serialize: (callback) => {
        if (callback) callback();
    }
};

// Initialize connection
connect().catch(console.error);

module.exports = db;
