const express = require('express');
const router = express.Router();

// GET comments for an article
router.get('/article/:articleId', (req, res) => {
  res.json({
    message: `Get comments for article ${req.params.articleId}`,
    data: []
  });
});

// POST create comment (protected)
router.post('/', (req, res) => {
  res.status(201).json({
    message: 'Comment created',
    data: {}
  });
});

// PUT update comment (protected)
router.put('/:id', (req, res) => {
  res.json({
    message: `Comment ${req.params.id} updated`,
    data: {}
  });
});

// DELETE comment (protected)
router.delete('/:id', (req, res) => {
  res.status(204).send();
});

module.exports = router;
