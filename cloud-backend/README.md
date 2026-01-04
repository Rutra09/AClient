# Cloud Backend

Node.js backend for TClient cloud sync with settings, assets, and user management.

## Database Configuration

### SQLite (Local Development)
Default configuration - no setup needed:
```env
DB_TYPE=sqlite
DB_PATH=./cloud.db
```

### MongoDB (Remote/Production - Recommended)
Configure in `.env`:
```env
DB_TYPE=mongodb
MONGODB_URI=mongodb://localhost:27017/cloud_db
```

Or for MongoDB Atlas:
```env
DB_TYPE=mongodb
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/cloud_db?retryWrites=true&w=majority
```

### PostgreSQL (Alternative Remote Option)
Configure in `.env`:
```env
DB_TYPE=postgres
DB_HOST=your-postgres-host.com
DB_PORT=5432
DB_NAME=cloud_db
DB_USER=postgres
DB_PASSWORD=your-password
DB_SSL=true
```

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start server:
   ```bash
   node server.js
   ```

## Features

- **Authentication**: JWT-based API authentication + session-based admin panel
- **Settings Sync**: Upload/download user settings in JSON format
- **Asset Management**: Version-controlled file storage
- **Admin Panel**: User management, file viewing, activity logs
- **Password Reset**: Admin-generated secure reset links

## API Endpoints

### Auth
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/reset-password?token=xxx` - Reset password form
- `POST /api/auth/reset-password` - Submit new password

### Settings
- `GET /api/settings` - Download settings (requires auth)
- `POST /api/settings` - Upload settings (requires auth)

### Assets
- `POST /api/assets` - Upload file (X-Filename header + raw body)
- `GET /api/assets/inventory` - List all user files
- `GET /api/assets/:filename` - Download file
- `GET /api/assets/versions/:filename` - Get file versions
- `DELETE /api/assets/:filename` - Delete file

### Admin (Web Interface)
- `/api/admin/login` - Admin login page
- `/api/admin/dashboard` - Admin dashboard
- `/api/admin/users` - User management
- `/api/admin/users/:id/reset-token` - Generate password reset link

## Admin Setup

Create admin user:
```bash
node make-admin.js <username>
```
