import axios from 'axios';

const API_BASE_URL = 'http://localhost:8080';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach JWT token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('nh_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle session expiries
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login if unauthorized
      localStorage.removeItem('nh_token');
      localStorage.removeItem('nh_user_email');
      
      // Prevent redirecting loops
      if (!window.location.pathname.includes('/login') && 
          !window.location.pathname.includes('/signup') && 
          window.location.pathname !== '/') {
        window.location.href = '/login?expired=true';
      }
    }
    return Promise.reject(error);
  }
);

export default client;
export { API_BASE_URL };
