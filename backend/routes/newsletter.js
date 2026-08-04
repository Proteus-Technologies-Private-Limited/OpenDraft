const express = require('express');
const router = express.Router();

// POST subscribe to newsletter
router.post('/subscribe', (req, res) => {
  res.status(201).json({
    message: 'Subscribed to newsletter',
    data: { email: req.body.email }
  });
});

// POST unsubscribe from newsletter
router.post('/unsubscribe', (req, res) => {
  res.json({
    message: 'Unsubscribed from newsletter',
    data: { email: req.body.email }
  });
});

// GET newsletter confirmation (verify email)
router.get('/verify/:token', (req, res) => {
  res.json({
    message: 'Email verified',
    data: {}
  });
});

module.exports = router;
