import React, { createContext, useState, useEffect, useContext } from 'react';
import client from '../api/client';
import { clearOfflineCaches } from '../pwa';
import { detachPushSubscription, resyncPushSubscription } from '../pushClient';

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  age: number | null;
  date_of_birth: string | null;
  gender: string | null;
  phone: string | null;
  alternate_phone: string | null;
  state_id: number | null;
  district_id: number | null;
  block_id: number | null;
  village_id: number | null;
  village_name: string | null;
  facility_id: number | null;
  qualification_id: number | null;
  experience_range_id: number | null;
  qualification_other_detail: string | null;
  state?: { id: number; name: string; is_active: boolean } | null;
  district_rel?: { id: number; state_id: number; name: string } | null;
  block?: { id: number; district_id: number; name: string } | null;
  village?: { id: number; block_id: number; name: string } | null;
  facility?: { id: number; block_id: number; name: string; facility_type: string } | null;
  qualification?: { id: number; qualification_name: string; has_semi_open_input: boolean } | null;
  experience_range?: { id: number; label: string; order_index: number } | null;
  department: string | null;
  role: string | null;
  work_center_type: string | null;
  work_center_name: string | null;
  district: string | null;
  avatar_initials: string | null;
  is_admin?: boolean;
  is_verified: boolean;
  program_district_id: number | null;
  program_district: { id: number; name: string; slug: string; is_active: boolean } | null;
  created_at: string;

  // ── Learner Registration: professional-axis FKs + extension fields ──
  department_id: number | null;
  designation_id: number | null;
  facility_type_id: number | null;
  department_other: string | null;
  designation_other: string | null;
  facility_type_other: string | null;
  marital_status: string | null;
  has_children: boolean | null;
  number_children: number | null;
  residence_distance_km: number | null;
  years_service: number | null;
  years_designation: number | null;
  years_facility: number | null;
  internet_workplace: string | null;
  nutrition_training: string | null;
  pregnancy_nutrition_training: string | null;
  breastfeeding_training: string | null;
  complementary_feeding_training: string | null;
  growth_monitoring_training: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  isVerified: boolean;
  isProfileComplete: boolean;
  login: (email: string, password: string) => Promise<any>;
  register: (email: string, password: string, fullName: string) => Promise<any>;
  verifyOtp: (email: string, code: string) => Promise<any>;
  forgotPassword: (email: string) => Promise<any>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<any>;
  googleLogin: (idToken: string) => Promise<any>;
  logout: () => void;
  updateProfile: (profileData: Partial<User>) => Promise<User>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** JWT `sub` (the user's email), or null when undecodable. */
const emailFromToken = (token: string | null): string | null => {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
};

/**
 * Shared-device hygiene: when a DIFFERENT account logs in, the previous
 * user's cached API data must go (an in-flight request can even repopulate
 * the cache after logout's clear — this closes that race). Same-user
 * re-logins keep their offline cache warm.
 */
const clearCachesOnIdentityChange = async (email: string | null): Promise<void> => {
  if (!email) return;
  const previous = localStorage.getItem('nh_last_user_email');
  if (previous && previous !== email) {
    await clearOfflineCaches();
    localStorage.removeItem('nh_user_cache');
  }
  localStorage.setItem('nh_last_user_email', email);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [isProfileComplete, setIsProfileComplete] = useState<boolean>(false);

  const refreshUser = async () => {
    const token = localStorage.getItem('nh_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await client.get('/api/users/me');
      setUser(response.data);
      setIsVerified(response.data.is_verified);
      setIsProfileComplete(!!response.data.role || !!response.data.is_admin);
      if (response.data.is_admin) {
        localStorage.setItem('nh_admin', 'true');
        localStorage.setItem('nh_admin_token', token);
        if (response.data.full_name) {
          localStorage.setItem('nh_admin_name', response.data.full_name);
        }
      }
      // Snapshot for offline app starts (below) — keyed to this account.
      try {
        localStorage.setItem('nh_user_cache', JSON.stringify(response.data));
      } catch { /* quota — snapshot is best-effort */ }
    } catch (error) {
      const hasResponse = (error as { response?: unknown }).response !== undefined;
      if (hasResponse) {
        // The server rejected the session — a real logout.
        console.error('Failed to fetch user:', error);
        logout();
      } else {
        // NETWORK failure (offline app start, backend down): logging the user
        // out here would lock field workers out of the offline app and wipe
        // their caches. Keep the session; hydrate from the last snapshot.
        const raw = localStorage.getItem('nh_user_cache');
        try {
          const cached = raw ? (JSON.parse(raw) as User) : null;
          if (cached && cached.email === emailFromToken(token)) {
            setUser(cached);
            setIsVerified(cached.is_verified);
            setIsProfileComplete(!!cached.role || !!cached.is_admin);
          }
        } catch { /* corrupt snapshot — stay logged out visually until online */ }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  // Keep this device's push endpoint attached to whoever is logged in (a
  // shared phone re-homes the subscription to the new account on login).
  useEffect(() => {
    if (user) void resyncPushSubscription();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string) => {
    const trimmedEmail = email.trim();
    const response = await client.post('/api/auth/login', { email: trimmedEmail, password });
    const { access_token, is_verified, is_profile_complete, is_admin } = response.data;

    localStorage.setItem('nh_token', access_token);
    localStorage.setItem('nh_user_email', trimmedEmail.toLowerCase());
    if (is_admin) {
      localStorage.setItem('nh_admin', 'true');
      localStorage.setItem('nh_admin_token', access_token);
      localStorage.setItem('nh_admin_name', trimmedEmail.split('@')[0]);
    }
    await clearCachesOnIdentityChange(emailFromToken(access_token) ?? trimmedEmail.toLowerCase());

    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);

    await refreshUser();
    return response.data;
  };

  const register = async (email: string, password: string, fullName: string) => {
    const trimmedEmail = email.trim();
    const response = await client.post('/api/auth/register', { 
      email: trimmedEmail, 
      password, 
      full_name: fullName 
    });
    const { access_token, is_verified, is_profile_complete, is_admin } = response.data;
    
    localStorage.setItem('nh_token', access_token);
    localStorage.setItem('nh_user_email', trimmedEmail.toLowerCase());
    if (is_admin) {
      localStorage.setItem('nh_admin', 'true');
      localStorage.setItem('nh_admin_token', access_token);
      localStorage.setItem('nh_admin_name', fullName || trimmedEmail.split('@')[0]);
    }
    await clearCachesOnIdentityChange(emailFromToken(access_token) ?? trimmedEmail.toLowerCase());

    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);

    await refreshUser();
    return response.data;
  };

  const verifyOtp = async (email: string, code: string) => {
    const trimmedEmail = email.trim();
    const response = await client.post('/api/auth/verify-otp', { email: trimmedEmail, code });
    const { access_token, is_verified, is_profile_complete, is_admin } = response.data;

    localStorage.setItem('nh_token', access_token);
    if (is_admin) {
      localStorage.setItem('nh_admin', 'true');
      localStorage.setItem('nh_admin_token', access_token);
      localStorage.setItem('nh_admin_name', trimmedEmail.split('@')[0]);
    }
    await clearCachesOnIdentityChange(emailFromToken(access_token) ?? trimmedEmail.toLowerCase());
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);

    await refreshUser();
    return response.data;
  };

  const forgotPassword = async (email: string) => {
    const response = await client.post('/api/auth/forgot-password', { email: email.trim() });
    return response.data;
  };

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    const response = await client.post(`/api/auth/reset-password?new_password=${encodeURIComponent(newPassword)}`, { email: email.trim(), code });
    return response.data;
  };

  const googleLogin = async (idToken: string) => {
    const response = await client.post('/api/auth/google', { id_token: idToken });
    const { access_token, is_verified, is_profile_complete, is_admin } = response.data;

    localStorage.setItem('nh_token', access_token);
    if (is_admin) {
      localStorage.setItem('nh_admin', 'true');
      localStorage.setItem('nh_admin_token', access_token);
    }
    await clearCachesOnIdentityChange(emailFromToken(access_token));
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);

    await refreshUser();
    return response.data;
  };

  const logout = () => {
    // Detach this device's push endpoint from the account (token snapshot —
    // the async call outlives the localStorage clear below).
    void detachPushSubscription(localStorage.getItem('nh_token'));
    localStorage.removeItem('nh_token');
    localStorage.removeItem('nh_user_email');
    localStorage.removeItem('nh_user_cache');
    localStorage.removeItem('nh_admin');
    localStorage.removeItem('nh_admin_token');
    localStorage.removeItem('nh_admin_name');
    localStorage.removeItem('nh_admin_district');
    // Cached API data must not survive into the next user's session. (The
    // offline queue stays — it is owner-scoped and only ever syncs under the
    // capturing account's own token.)
    void clearOfflineCaches();
    setUser(null);
    setIsVerified(false);
    setIsProfileComplete(false);
    setLoading(false);
  };

  const updateProfile = async (profileData: Partial<User>) => {
    const response = await client.put('/api/users/me', profileData);
    setUser(response.data);
    setIsProfileComplete(!!response.data.role || !!response.data.is_admin);
    return response.data;
  };

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    isVerified,
    isProfileComplete,
    login,
    register,
    verifyOtp,
    forgotPassword,
    resetPassword,
    googleLogin,
    logout,
    updateProfile,
    refreshUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
