# Setup Guide

## Prerequisites

- Node.js 16 or higher
- PostgreSQL 12 or higher
- npm or yarn

## Quick Start

### 1. Database Setup

**Create PostgreSQL database:**
```bash
createdb news_db
```

**Run migrations** (after setting up backend):
```bash
cd backend
npm run migrate
```

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
```

**Edit `.env` with your settings:**
```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=news_db
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_secret_key_change_this
NODE_ENV=development
```

**Start the server:**
```bash
npm run dev
```

Server will run on `http://localhost:5000`

### 3. Frontend Setup

```bash
cd frontend
npm install
```

**Start development server:**
```bash
npm run dev
```

Frontend will run on `http://localhost:5173`

## Project Structure

```
NewsWebsite/
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable React components
│   │   ├── pages/            # Page components
│   │   ├── services/         # API services
│   │   ├── utils/            # Utility functions
│   │   └── App.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── backend/
│   ├── routes/               # API route handlers
│   ├── controllers/          # Business logic
│   ├── models/               # Database models
│   ├── middleware/           # Express middleware
│   ├── config/               # Configuration files
│   ├── server.js
│   └── package.json
├── docs/
│   ├── API.md               # API documentation
│   └── DATABASE.md          # Database schema
└── README.md
```

## Development Workflow

1. **Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

2. **Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

3. Open `http://localhost:5173` in your browser

## Building for Production

**Frontend:**
```bash
cd frontend
npm run build
# Output in dist/
```

**Backend:**
No build step needed for backend. Just ensure dependencies are installed:
```bash
cd backend
npm install --production
npm start
```

## Common Issues

### Database Connection Error
- Ensure PostgreSQL is running
- Check database name, user, and password in `.env`
- Verify database exists: `psql -l`

### Port Already in Use
- Change `PORT` in backend `.env`
- Vite port can be changed in `frontend/vite.config.js`

### CORS Issues
- Ensure backend CORS is properly configured
- Check API base URL in frontend services

## Next Steps

1. **Create initial categories** using the API
2. **Add admin endpoints** for article management
3. **Implement authentication** fully with sessions
4. **Add image upload** functionality
5. **Set up email notifications** for newsletter
6. **Deploy** to your hosting platform
