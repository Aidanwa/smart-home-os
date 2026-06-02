// services/gateway/frontend/src/context/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

interface UserProfile {
  id: string;
  username: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserProfile | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  logout: () => Promise<void>;
  authenticatedFetch: (url: string, options?: RequestInit) => Promise<Response>; // <-- ADDED THIS
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
        try {
        const response = await originalFetch(...args);
        
        // Intercept 401 Unauthorized responses across the whole application
        if (response.status === 401) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
            
            // Skip intercepting the check-session route itself to avoid loop crashes
            if (!url.includes('/api/auth/me') && !url.includes('/api/auth/login')) {
            console.warn("Session expired or unauthorized request intercepted. Redirecting to auth entry context.");
            setIsAuthenticated(false);
            setUser(null);
            }
        }
        
        return response;
        } catch (error) {
        // Forward network errors cleanly
        throw error;
        }
    };

    // Gracefully restore pristine window context on unmount
    return () => {
        window.fetch = originalFetch;
    };
    }, []);

  // Global Response Interception wrapper for native fetch
  const authenticatedFetch = async (url: string, options?: RequestInit) => {
    const res = await fetch(url, options);
    if (res.status === 401) {
      setIsAuthenticated(false);
      setUser(null);
    }
    return res;
  };

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        await checkAuthStatus();
        return { success: true };
      }
      return { success: false, error: data.detail || 'Authentication failed.' };
    } catch (err) {
      return { success: false, error: 'Network error occurred during sign-in.' };
    }
  };

  const register = async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.detail || 'Registration failed.' };
    } catch (err) {
      return { success: false, error: 'Network configuration error.' };
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    // <-- INJECTED INTO PROVIDER VALUE HERE
    <AuthContext.Provider value={{ isAuthenticated, user, isLoading, login, register, logout, authenticatedFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be invoked within an AuthProvider schema.');
  return context;
}


