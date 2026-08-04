const express = require('express');
const router = express.Router();

// GET all categories
router.get('/', (req, res) => {
  res.json({
    message: 'Get all categories',
    data: []
  });
});

// GET articles by category
router.get('/:slug/articles', (req, res) => {
  res.json({
    message: `Get articles in category: ${req.params.slug}`,
    data: []
  });
});

// POST create category (protected)
router.post('/', (req, res) => {
  res.status(201).json({
    message: 'Category created',
    data: {}
  });
});

// PUT update category (protected)
router.put('/:id', (req, res) => {
  res.json({
    message: `Category ${req.params.id} updated`,
    data: {}
  });
});

// DELETE category (protected)
router.delete('/:id', (req, res) => {
  res.status(204).send();
});

module.exports = router;
