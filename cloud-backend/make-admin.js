require('dotenv').config();
const db = require('./database');

const username = process.argv[2];

if (!username) {
    console.error('Usage: node make-admin.js <username>');
    console.error('Example: node make-admin.js admin');
    process.exit(1);
}

// Wait for database to initialize
setTimeout(() => {
    db.get('SELECT id, username, role FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            process.exit(1);
        }
        
        if (!user) {
            console.error(`User "${username}" not found.`);
            console.error('Please create the account first via the /api/auth/register endpoint.');
            process.exit(1);
        }
        
        if (user.role === 'admin') {
            console.log(`User "${username}" is already an admin.`);
            process.exit(0);
        }
        
        db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id], (err) => {
            if (err) {
                console.error('Error updating user role:', err);
                process.exit(1);
            }
            
            console.log(`✓ User "${username}" (ID: ${user.id}) is now an admin!`);
            process.exit(0);
        });
    });
}, 1000);
