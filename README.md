# News Website

A modern, full-stack news website built with React, Node.js, and PostgreSQL.

## Features

- 📰 Article management and publishing
- 🏷️ Categories and tags
- ⭐ Featured articles
- 🔍 Search functionality
- 👤 User authentication & profiles
- 💬 Comments on articles
- 📧 Newsletter subscription
- 📱 Responsive design
- 🌙 Dark mode support

## Tech Stack

**Frontend:**
- React 18+ with Vite
- Tailwind CSS for styling
- React Router for navigation
- Axios for API calls

**Backend:**
- Node.js + Express
- PostgreSQL database
- JWT authentication
- bcryptjs for password hashing

**Database:**
- PostgreSQL with Sequelize ORM

## Project Structure

```
NewsWebsite/
├── frontend/                 # React app
│   ├── src/
│   │   ├── components/       # Reusable components
│   │   ├── pages/            # Page components
│   │   ├── services/         # API services
│   │   ├── utils/            # Utility functions
│   │   └── App.jsx
│   └── package.json
├── backend/                  # Node.js API
│   ├── config/               # Database & environment config
│   ├── models/               # Database models
│   ├── routes/               # API routes
│   ├── controllers/          # Route handlers
│   ├── middleware/           # Custom middleware
│   ├── server.js
│   └── package.json
├── docs/                     # Documentation
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 16+
- PostgreSQL 12+
- npm or yarn

### Installation

1. **Clone the repository**
```bash
cd NewsWebsite
```

2. **Setup Backend**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your database credentials
npm run dev
```

3. **Setup Frontend**
```bash
cd ../frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

## API Documentation

See [docs/API.md](docs/API.md) for complete API reference.

## Database Schema

See [docs/DATABASE.md](docs/DATABASE.md) for database schema details.

## Contributing

Pull requests welcome! Please follow the existing code style.

## License

MIT
