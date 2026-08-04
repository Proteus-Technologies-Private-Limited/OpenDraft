# API Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication
All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Articles Endpoints

### GET /articles
Get all articles with pagination and filters.

**Query Parameters:**
- `page` (int, default: 1)
- `limit` (int, default: 10)
- `category` (string, optional)
- `search` (string, optional)

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "title": "Breaking News",
      "slug": "breaking-news",
      "excerpt": "...",
      "content": "...",
      "image": "...",
      "category": "Technology",
      "author": "John Doe",
      "views": 1500,
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 50
}
```

### GET /articles/featured
Get featured articles.

### GET /articles/:slug
Get a single article by slug.

### POST /articles (Protected)
Create a new article.

**Request Body:**
```json
{
  "title": "Article Title",
  "slug": "article-slug",
  "excerpt": "Brief summary",
  "content": "Full article content",
  "categoryId": 1,
  "image": "image_url"
}
```

### PUT /articles/:id (Protected)
Update an article.

### DELETE /articles/:id (Protected)
Delete an article.

---

## Categories Endpoints

### GET /categories
Get all categories.

### GET /categories/:slug/articles
Get articles in a specific category.

### POST /categories (Protected)
Create a category.

### PUT /categories/:id (Protected)
Update a category.

### DELETE /categories/:id (Protected)
Delete a category.

---

## Users Endpoints

### POST /users/register
Register a new user.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### POST /users/login
Login a user.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

### GET /users/profile (Protected)
Get current user's profile.

### PUT /users/profile (Protected)
Update user profile.

### POST /users/logout
Logout user.

---

## Comments Endpoints

### GET /comments/article/:articleId
Get comments for an article.

### POST /comments (Protected)
Create a comment.

**Request Body:**
```json
{
  "articleId": 1,
  "text": "Great article!"
}
```

### PUT /comments/:id (Protected)
Update a comment.

### DELETE /comments/:id (Protected)
Delete a comment.

---

## Newsletter Endpoints

### POST /newsletter/subscribe
Subscribe to newsletter.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

### POST /newsletter/unsubscribe
Unsubscribe from newsletter.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

### GET /newsletter/verify/:token
Verify newsletter subscription email.

---

## Error Responses

All endpoints return errors in this format:
```json
{
  "error": "Error message here"
}
```

**Common Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error
