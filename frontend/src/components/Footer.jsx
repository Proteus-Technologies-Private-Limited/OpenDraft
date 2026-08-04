import { Link } from 'react-router-dom';
import { useState } from 'react';
import { newsletterAPI } from '../services/api';

function Footer() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = async (e) => {
    e.preventDefault();
    try {
      await newsletterAPI.subscribe(email);
      setSubscribed(true);
      setEmail('');
      setTimeout(() => setSubscribed(false), 3000);
    } catch (err) {
      console.error('Newsletter subscription failed');
    }
  };

  return (
    <footer className="bg-primary text-white mt-16">
      <div className="container py-12">
        <div className="grid grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="text-xl font-bold mb-4">NewsHub</h3>
            <p className="text-gray-300">
              Your source for breaking news and in-depth stories.
            </p>
          </div>
          <div>
            <h4 className="font-bold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-gray-300">
              <li><Link to="/" className="hover:text-secondary">Home</Link></li>
              <li><Link to="/" className="hover:text-secondary">About</Link></li>
              <li><Link to="/" className="hover:text-secondary">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-4">Newsletter</h4>
            <form onSubmit={handleSubscribe} className="flex flex-col gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email"
                className="input-field bg-gray-700 border-gray-600 text-white"
                required
              />
              <button type="submit" className="btn btn-secondary">
                Subscribe
              </button>
              {subscribed && <p className="text-green-400 text-sm">Thanks for subscribing!</p>}
            </form>
          </div>
        </div>
        <div className="border-t border-gray-700 pt-8 text-center text-gray-400">
          <p>&copy; 2024 NewsHub. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
