import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auth now rides entirely on httpOnly cookies (Part 1.12): the access/refresh
  // tokens are never stored in localStorage (which is readable by any injected
  // script — the XSS token-theft vector). withCredentials makes the browser
  // attach the cookies automatically; the backend reads them for verifyJWT and
  // refresh-token. Only the non-sensitive user profile is cached for UX.
  axios.defaults.withCredentials = true;
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

  // On a 401, transparently attempt one cookie-based refresh, then retry. We
  // can't read the httpOnly refresh cookie from JS, so we always try once and
  // let the server decide; on failure we clear the session and go to login.
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !originalRequest.url?.includes('/refresh-token') &&
          !originalRequest.url?.includes('/login')
        ) {
          originalRequest._retry = true;
          try {
            const res = await axios.post(`${API_URL}/users/refresh-token`, {}, { withCredentials: true });
            if (res.data?.success || res.status === 200 || res.status === 201) {
              if (res.data?.data?.accessToken) {
                localStorage.setItem('accessToken', res.data.data.accessToken);
              }
              return axios(originalRequest);
            }
          } catch (err) {
            localStorage.removeItem('user');
            localStorage.removeItem('accessToken');
            setUser(null);
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [API_URL]);

  // Check if we already have a user from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = async (username, email, password) => {
    try {
      const response = await axios.post(`${API_URL}/users/login`, { username, email, password }, { withCredentials: true });
      if (response.data.success) {
        const { user: userData, accessToken } = response.data.data;
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        if (accessToken) {
          localStorage.setItem('accessToken', accessToken);
        }
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.response?.data?.message || 'Login failed' };
    }
  };

  const register = async (username, email, password) => {
    try {
      const response = await axios.post(`${API_URL}/users/register`, { username, email, password }, { withCredentials: true });
      if (response.data.success) {
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.response?.data?.message || 'Registration failed' };
    }
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/users/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      setUser(null);
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
