import axios from 'axios';
import { API_BASE_URL } from './config';
import { clearOfflineCaches } from '../pwa';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// True for admin-scoped endpoints (which authenticate with the admin token),
// except the admin login itself which is public.
const isAdminRequest = (url?: string): boolean =>
  !!url && url.startsWith('/api/admin') && !url.startsWith('/api/admin/login');

// Request interceptor: attach the correct JWT.
// Admin endpoints authenticate with nh_admin_token; everything else with nh_token.
client.interceptors.request.use(
  (config) => {
    const admin = isAdminRequest(config.url);
    const token = admin
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

// Session expiry via this interceptor is the NORMAL end of session on shared
// field devices (24h learner JWTs, no refresh) — it must scrub the SW's
// cached API data exactly like an explicit logout, or the next user could
// read the previous user's mothers/notifications offline.
let expiring = false;
const expireSession = (redirectTo: string | null) => {
  if (expiring) return;
  expiring = true;
  void clearOfflineCaches().finally(() => {
    if (redirectTo) window.location.href = redirectTo;
    else expiring = false;
  });
};

// Response interceptor to handle session expiries
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const admin = isAdminRequest(error.config?.url);

      if (admin) {
        // Admin session expired — clear admin creds and bounce to admin login.
        localStorage.removeItem('nh_admin_token');
        localStorage.removeItem('nh_admin');
        localStorage.removeItem('nh_admin_name');
        expireSession(
          !window.location.pathname.includes('/login') ? '/login?admin=1&expired=true' : null,
        );
      } else {
        // Student session expired — clear user creds and redirect to login.
        localStorage.removeItem('nh_token');
        localStorage.removeItem('nh_user_email');
        const shouldRedirect =
          !window.location.pathname.includes('/login') &&
          !window.location.pathname.includes('/signup') &&
          window.location.pathname !== '/';
        expireSession(shouldRedirect ? '/login?expired=true' : null);
      }
    }
    return Promise.reject(error);
  }
);

export default client;
export { API_BASE_URL };
