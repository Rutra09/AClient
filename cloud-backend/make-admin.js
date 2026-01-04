const db = require('./database');

// Make user ID 1 an admin
setTimeout(() => {
    db.run(`UPDATE users SET role = 'admin' WHERE id = 1`, (err) => {
        if (err) {
            console.error('Error updating user role:', err);
        } else {
            console.log('User ID 1 is now an admin');
        }
        process.exit(0);
    });
}, 1000);
