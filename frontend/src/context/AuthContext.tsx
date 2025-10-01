'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface User {
  username: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER';
  isApprover: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check for existing authentication on mount
    const checkAuth = () => {
      try {
        const authData = localStorage.getItem('nexus_auth');
        if (authData) {
          const parsed = JSON.parse(authData);
          if (parsed.isAuthenticated) {
            // Mock user data - in real app this would come from API
            const isAdmin = parsed.username === 'adam' || parsed.username === 'kris';
            setUser({
              username: parsed.username,
              role: isAdmin ? 'ADMIN' : 'OPERATOR',
              isApprover: isAdmin
            });
          }
        }
      } catch (error) {
        console.error('Error checking auth:', error);
        localStorage.removeItem('nexus_auth');
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  useEffect(() => {
    // Redirect to login if not authenticated and not on login page
    if (!isLoading && !user && pathname !== '/auth/login') {
      router.push('/auth/login');
    }
  }, [user, isLoading, pathname, router]);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      // Mock authentication logic - Adam and Kris are admins
      const validCredentials = [
        { username: 'adam', password: 'nexus123', role: 'ADMIN', isApprover: true },
        { username: 'kris', password: 'nexus123', role: 'ADMIN', isApprover: true },
        { username: 'praful', password: 'nexus123', role: 'OPERATOR', isApprover: false },
        { username: 'max', password: 'nexus123', role: 'OPERATOR', isApprover: false },
        { username: 'preet', password: 'nexus123', role: 'OPERATOR', isApprover: false },
        { username: 'kanav', password: 'nexus123', role: 'OPERATOR', isApprover: false }
      ];

      const validUser = validCredentials.find(
        cred => cred.username === username && cred.password === password
      );

      if (validUser) {
        const userData: User = {
          username: validUser.username,
          role: validUser.role as 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER',
          isApprover: validUser.isApprover
        };

        setUser(userData);

        // Store in localStorage
        localStorage.setItem('nexus_auth', JSON.stringify({
          username: userData.username,
          isAuthenticated: true,
          loginTime: Date.now()
        }));

        return true;
      }

      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('nexus_auth');
    router.push('/auth/login');
  };

  const value = {
    user,
    isAuthenticated: !!user,
    login,
    logout,
    isLoading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}