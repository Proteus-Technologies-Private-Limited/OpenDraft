const express = require('express');
const router = express.Router();

// POST user registration
router.post('/register', (req, res) => {
  res.status(201).json({
    message: 'User registered',
    data: { id: 1, email: req.body.email }
  });
});

// POST user login
router.post('/login', (req, res) => {
  res.json({
    message: 'Login successful',
    token: 'jwt_token_here',
    user: { id: 1, email: req.body.email }
  });
});

// GET user profile (protected)
router.get('/profile', (req, res) => {
  res.json({
    message: 'Get user profile',
    data: {}
  });
});

// PUT update user profile (protected)
router.put('/profile', (req, res) => {
  res.json({
    message: 'Profile updated',
    data: {}
  });
});

// POST logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
