require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const db = require('./database');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const assetsRoutes = require('./routes/assets');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.SESSION_SECURE === 'true',
        httpOnly: process.env.SESSION_HTTP_ONLY !== 'false',
        maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000
    }
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
}));
app.use('/api/assets', express.raw({ type: () => true, limit: process.env.MAX_FILE_SIZE || '20mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const fs = require('fs');
const uploadsDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
    res.send('Cloud Backend Running - <a href="/api/admin/login">Admin Login</a>');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin login: http://localhost:${PORT}/api/admin/login`);
});
