import React, { createContext, useState, useEffect, useContext } from 'react';
import client from '../api/client';

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
  is_verified: boolean;
  program_district_id: number | null;
  program_district: { id: number; name: string; slug: string; is_active: boolean } | null;
  created_at: string;

  // ── Learner Registration: professional-axis FKs + extension fields ──
  department_id: number | null;
  designation_id: number | null;
  facility_type_id: number | null;
  department_other: string | null;
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
      setIsProfileComplete(!!response.data.role); // Role being set indicates registration completes
    } catch (error) {
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await client.post('/api/auth/login', { email, password });
    const { access_token, is_verified, is_profile_complete } = response.data;
    
    localStorage.setItem('nh_token', access_token);
    localStorage.setItem('nh_user_email', email);
    
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);
    
    await refreshUser();
    return response.data;
  };

  const register = async (email: string, password: string, fullName: string) => {
    const response = await client.post('/api/auth/register', { 
      email, 
      password, 
      full_name: fullName 
    });
    const { access_token, is_verified, is_profile_complete } = response.data;
    
    localStorage.setItem('nh_token', access_token);
    localStorage.setItem('nh_user_email', email);
    
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);
    
    await refreshUser();
    return response.data;
  };

  const verifyOtp = async (email: string, code: string) => {
    const response = await client.post('/api/auth/verify-otp', { email, code });
    const { access_token, is_verified, is_profile_complete } = response.data;
    
    localStorage.setItem('nh_token', access_token);
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);
    
    await refreshUser();
    return response.data;
  };

  const forgotPassword = async (email: string) => {
    const response = await client.post('/api/auth/forgot-password', { email });
    return response.data;
  };

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    const response = await client.post(`/api/auth/reset-password?new_password=${encodeURIComponent(newPassword)}`, { email, code });
    return response.data;
  };

  const googleLogin = async (idToken: string) => {
    const response = await client.post('/api/auth/google', { id_token: idToken });
    const { access_token, is_verified, is_profile_complete } = response.data;
    
    localStorage.setItem('nh_token', access_token);
    setIsVerified(is_verified);
    setIsProfileComplete(is_profile_complete);
    
    await refreshUser();
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('nh_token');
    localStorage.removeItem('nh_user_email');
    setUser(null);
    setIsVerified(false);
    setIsProfileComplete(false);
    setLoading(false);
  };

  const updateProfile = async (profileData: Partial<User>) => {
    const response = await client.put('/api/users/me', profileData);
    setUser(response.data);
    setIsProfileComplete(!!response.data.role);
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
