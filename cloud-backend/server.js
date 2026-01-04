const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const assetsRoutes = require('./routes/assets');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use('/api/assets', express.raw({ type: () => true, limit: '20mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const fs = require('fs');
if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/assets', assetsRoutes);

app.get('/', (req, res) => {
    res.send('Cloud Backend Running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
