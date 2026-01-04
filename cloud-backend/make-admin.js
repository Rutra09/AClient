require('dotenv').config();
const { ObjectId } = require('mongodb');
const database = require('./database');

const username = process.argv[2];

if (!username) {
    console.error('Usage: node make-admin.js <username>');
    console.error('Example: node make-admin.js admin');
    process.exit(1);
}

async function makeAdmin() {
    try {
        await database.connectDB();
        const db = database.getDatabase();
        
        const user = await db.collection('users').findOne({ username });
        
        if (!user) {
            console.error(`User "${username}" not found.`);
            console.error('Please create the account first via the /api/auth/register endpoint.');
            process.exit(1);
        }
        
        if (user.role === 'admin') {
            console.log(`User "${username}" is already an admin.`);
            process.exit(0);
        }
        
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { role: 'admin' } }
        );

        console.log(`✓ User "${username}" (ID: ${user._id}) is now an admin!`);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

makeAdmin();
