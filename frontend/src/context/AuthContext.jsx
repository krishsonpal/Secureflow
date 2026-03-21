import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  axios.defaults.withCredentials = true;
  console.log("API URL:", import.meta.env.VITE_API_URL);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

  // Setup Axios interceptors
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const token = localStorage.getItem('accessToken');
      if (token && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    }, (error) => {
      return Promise.reject(error);
    });

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url.includes('/refresh-token')) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem('refreshToken');
          
          if (refreshToken) {
            try {
              const res = await axios.post(`${API_URL}/users/refresh-token`, { refreshToken }, { withCredentials: true });
              if (res.data?.success || res.status === 200 || res.status === 201) {
                const newAccessToken = res.data?.data?.accessToken;
                if (newAccessToken) {
                  localStorage.setItem('accessToken', newAccessToken);
                  originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                  return axios(originalRequest);
                }
              }
            } catch (err) {
              // Refresh failed
              localStorage.removeItem('user');
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
              setUser(null);
              window.location.href = '/login';
            }
          } else {
            // No refresh token available
            localStorage.removeItem('user');
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
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
        setUser(response.data.data.user);
        localStorage.setItem('user', JSON.stringify(response.data.data.user));
        // Storing tokens for cross-site requests fallback
        if (response.data.data.accessToken) {
          localStorage.setItem('accessToken', response.data.data.accessToken);
        }
        if (response.data.data.refreshToken) {
          localStorage.setItem('refreshToken', response.data.data.refreshToken);
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
      localStorage.removeItem('refreshToken');
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
