import { apiService } from '@/services/api';
import { User } from '@/types';

export async function authenticateUser(username: string, password: string): Promise<User> {
  try {
    const response = await apiService.login(username, password);
    return response.user;
  } catch (error) {
    throw new Error('Invalid credentials');
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiService.getCurrentUser();
  } catch (error) {
    return null;
  }
}

export function logout() {
  apiService.removeToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/auth/login';
  }
}

export function isAuthenticated(): boolean {
  return !!apiService.getToken();
}