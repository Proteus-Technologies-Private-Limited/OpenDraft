import axios from 'axios';

const API = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  }
});

// Add token to requests
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Articles API
export const articleAPI = {
  getAll: (page = 1, limit = 10, category = '', search = '') =>
    API.get('/articles', { params: { page, limit, category, search } }),
  getFeatured: () => API.get('/articles/featured'),
  getBySlug: (slug) => API.get(`/articles/${slug}`),
  create: (data) => API.post('/articles', data),
  update: (id, data) => API.put(`/articles/${id}`, data),
  delete: (id) => API.delete(`/articles/${id}`),
};

// Categories API
export const categoryAPI = {
  getAll: () => API.get('/categories'),
  getBySlug: (slug) => API.get(`/categories/${slug}/articles`),
  create: (data) => API.post('/categories', data),
  update: (id, data) => API.put(`/categories/${id}`, data),
  delete: (id) => API.delete(`/categories/${id}`),
};

// Users API
export const userAPI = {
  register: (data) => API.post('/users/register', data),
  login: (data) => API.post('/users/login', data),
  getProfile: () => API.get('/users/profile'),
  updateProfile: (data) => API.put('/users/profile', data),
  logout: () => API.post('/users/logout'),
};

// Comments API
export const commentAPI = {
  getByArticle: (articleId) => API.get(`/comments/article/${articleId}`),
  create: (data) => API.post('/comments', data),
  update: (id, data) => API.put(`/comments/${id}`, data),
  delete: (id) => API.delete(`/comments/${id}`),
};

// Newsletter API
export const newsletterAPI = {
  subscribe: (email) => API.post('/newsletter/subscribe', { email }),
  unsubscribe: (email) => API.post('/newsletter/unsubscribe', { email }),
  verify: (token) => API.get(`/newsletter/verify/${token}`),
};

export default API;
