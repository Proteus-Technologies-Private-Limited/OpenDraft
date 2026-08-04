const express = require('express');
const router = express.Router();

// GET all articles with pagination
router.get('/', (req, res) => {
  const { page = 1, limit = 10, category, search } = req.query;
  res.json({
    message: 'Get articles',
    page: parseInt(page),
    limit: parseInt(limit),
    filters: { category, search },
    data: []
  });
});

// GET featured articles
router.get('/featured', (req, res) => {
  res.json({
    message: 'Get featured articles',
    data: []
  });
});

// GET single article by slug
router.get('/:slug', (req, res) => {
  res.json({
    message: `Get article: ${req.params.slug}`,
    data: {}
  });
});

// POST create article (protected)
router.post('/', (req, res) => {
  res.status(201).json({
    message: 'Article created',
    data: {}
  });
});

// PUT update article (protected)
router.put('/:id', (req, res) => {
  res.json({
    message: `Article ${req.params.id} updated`,
    data: {}
  });
});

// DELETE article (protected)
router.delete('/:id', (req, res) => {
  res.status(204).send();
});

module.exports = router;
