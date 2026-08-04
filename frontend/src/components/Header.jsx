import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

function Header() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(!!token);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    navigate('/');
  };

  return (
    <header className="bg-primary text-white shadow-lg">
      <div className="container py-6">
        <div className="flex justify-between items-center">
          <Link to="/" className="text-3xl font-bold text-secondary">
            📰 NewsHub
          </Link>
          <nav className="flex gap-6 items-center">
            <Link to="/" className="hover:text-secondary transition">
              Home
            </Link>
            <Link to="/" className="hover:text-secondary transition">
              Categories
            </Link>
            <input
              type="search"
              placeholder="Search articles..."
              className="px-4 py-2 rounded-lg bg-gray-700 text-white placeholder-gray-400"
            />
            {isLoggedIn ? (
              <>
                <Link to="/profile" className="hover:text-secondary transition">
                  Profile
                </Link>
                <button
                  onClick={handleLogout}
                  className="btn btn-secondary px-6"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-secondary transition">
                  Login
                </Link>
                <Link to="/register" className="btn btn-primary px-6">
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

export default Header;
