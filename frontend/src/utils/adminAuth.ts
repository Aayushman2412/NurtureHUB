/** Clears the admin session from localStorage. Caller is responsible for navigating afterward. */
export const clearAdminSession = (): void => {
  localStorage.removeItem('nh_admin');
  localStorage.removeItem('nh_admin_token');
  localStorage.removeItem('nh_admin_name');
  localStorage.removeItem('nh_admin_district');
};
