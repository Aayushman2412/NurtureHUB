import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// /api/admin/* requests (except login) authenticate with the admin token;
// everything else uses the member token.
const isAdminRequest = (url: string) =>
  url.startsWith('/api/admin') && !url.startsWith('/api/admin/login');

const clearAdminSession = () => {
  localStorage.removeItem('nh_admin');
  localStorage.removeItem('nh_admin_token');
  localStorage.removeItem('nh_admin_name');
};

// Request interceptor to attach the appropriate JWT token
client.interceptors.request.use(
  (config) => {
    const url = config.url || '';
    const token = isAdminRequest(url)
      ? localStorage.getItem('nh_admin_token')
      : localStorage.getItem('nh_token');
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
    const status = error.response?.status;
    const url = error.config?.url || '';

    if (status === 401 || (status === 403 && isAdminRequest(url))) {
      if (isAdminRequest(url)) {
        // Admin token missing/expired/invalid — drop admin session and re-auth.
        clearAdminSession();
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login?expired=true';
        }
      } else if (status === 401) {
        // Member token expired.
        localStorage.removeItem('nh_token');
        localStorage.removeItem('nh_user_email');

        // Prevent redirecting loops
        if (!window.location.pathname.includes('/login') &&
          !window.location.pathname.includes('/signup') &&
          window.location.pathname !== '/') {
          window.location.href = '/login?expired=true';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default client;
export { API_BASE_URL };
