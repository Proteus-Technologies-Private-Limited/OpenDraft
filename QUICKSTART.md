# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend (in another terminal)
cd frontend
npm install
```

### Step 2: Setup Database

Create a PostgreSQL database:
```bash
createdb news_db
```

### Step 3: Configure Environment

**Backend** - Create `.env` file in `backend/` folder:
```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=news_db
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=dev_secret_key_change_in_production
NODE_ENV=development
```

### Step 4: Run Both Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
# Server runs on http://localhost:5000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# App runs on http://localhost:5173
```

### Step 5: Start Using!

Open your browser to `http://localhost:5173` 🎉

---

## 📋 Features

✅ **Articles** - Create, read, update, delete articles
✅ **Categories** - Organize articles by topic
✅ **User Accounts** - Register, login, manage profile
✅ **Comments** - Users can comment on articles
✅ **Newsletter** - Email subscription feature
✅ **Search** - Find articles by keyword
✅ **Responsive Design** - Works on mobile & desktop
✅ **Modern UI** - Built with Tailwind CSS

---

## 📁 Project Structure

```
NewsWebsite/
├── frontend/              # React + Vite
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── pages/        # Page components
│   │   ├── services/     # API client
│   │   └── App.jsx
│   └── package.json
├── backend/              # Node.js + Express
│   ├── routes/           # API endpoints
│   ├── middleware/       # Custom middleware
│   ├── server.js
│   └── package.json
├── docs/                 # Documentation
│   ├── API.md
│   ├── DATABASE.md
│   └── SETUP.md
└── README.md
```

---

## 🔌 API Endpoints (Main)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/articles` | Get all articles |
| GET | `/api/articles/featured` | Get featured articles |
| GET | `/api/articles/:slug` | Get single article |
| POST | `/api/users/register` | Create account |
| POST | `/api/users/login` | Login |
| GET | `/api/categories` | Get all categories |
| POST | `/api/comments` | Add comment (auth required) |
| POST | `/api/newsletter/subscribe` | Subscribe to newsletter |

See full docs in `docs/API.md`

---

## 🛠️ Development Tips

- **Auto-reload**: Both frontend and backend auto-reload on file changes
- **Proxy requests**: Frontend automatically proxies API calls to backend
- **Database**: Use PostgreSQL locally, check `.env` settings
- **Style**: Using Tailwind CSS - update `tailwind.config.js` for custom colors

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 5173 in use | Change port in `frontend/vite.config.js` |
| Port 5000 in use | Change `PORT` in `backend/.env` |
| DB connection fails | Check PostgreSQL is running, `.env` credentials |
| API not working | Ensure backend is running on port 5000 |

---

## 📚 Learn More

- [Full API Documentation](docs/API.md)
- [Database Schema](docs/DATABASE.md)
- [Setup Guide](docs/SETUP.md)
- [React Documentation](https://react.dev)
- [Express Documentation](https://expressjs.com)
- [Tailwind CSS](https://tailwindcss.com)

---

## ✨ Next Steps

1. Create some test articles via API
2. Add admin dashboard for content management
3. Implement image upload functionality
4. Set up email notifications
5. Deploy to production (Vercel, Heroku, etc.)

**Happy coding! 🚀**
