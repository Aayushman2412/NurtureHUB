/**
 * API wrappers for admin-identity endpoints.
 */

import client from './client';

export interface AdminProfile {
  email: string;
  full_name: string;
  is_hardcoded: boolean;
  created_at: string | null;
}

export const adminGetProfile = (): Promise<AdminProfile> =>
  client.get('/api/admin/me').then(r => r.data);

export const adminUpdateProfile = (data: { full_name: string }): Promise<AdminProfile> =>
  client.put('/api/admin/me', data).then(r => r.data);

export const adminChangePassword = (data: {
  current_password: string;
  new_password: string;
}): Promise<void> => client.post('/api/admin/me/password', data).then(() => undefined);
