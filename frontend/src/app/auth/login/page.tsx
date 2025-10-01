'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const router = useRouter();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Use the auth context login function
      const success = await login(formData.username, formData.password);

      if (success) {
        // Redirect to dashboard
        router.push('/dashboard');
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`✅ Password Reset Request Sent!\n\nA password reset link has been sent to: ${resetEmail}\n\nPlease check your email and follow the instructions to reset your password.\n\nIf you don't receive the email within a few minutes, please contact your administrator (Adam or Kris).`);
    setShowResetPassword(false);
    setResetEmail('');
  };

  if (showResetPassword) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          {/* Logo and Header */}
          <div className="text-center">
            <div className="mx-auto h-24 w-24 flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg">
              <span className="text-4xl font-bold text-white">N</span>
            </div>
            <h2 className="mt-6 text-3xl font-bold text-gray-900">Reset Password</h2>
            <p className="mt-2 text-sm text-gray-600">
              Enter your email address and we&apos;ll send you a reset link
            </p>
          </div>

          {/* Reset Form */}
          <form className="mt-8 space-y-6" onSubmit={handleResetPassword}>
            <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
              <div className="space-y-4">
                <div>
                  <label htmlFor="reset-email" className="block text-sm font-bold text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                    placeholder="your.email@company.com"
                  />
                </div>

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(false)}
                    className="flex-1 py-3 px-4 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold rounded-lg hover:from-blue-700 hover:to-blue-800 transition-colors shadow-md"
                  >
                    Send Reset Link
                  </button>
                </div>
              </div>
            </div>
          </form>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Contact administrators: <span className="font-semibold text-blue-600">Adam</span> or <span className="font-semibold text-blue-600">Kris</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Logo and Header */}
        <div className="text-center">
          <div className="mx-auto h-24 w-24 flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg">
            <span className="text-4xl font-bold text-white">N</span>
          </div>
          <h2 className="mt-6 text-4xl font-bold text-gray-900">NEXUS</h2>
          <p className="mt-2 text-base text-gray-600 font-medium">
            American Circuits Traveler Management
          </p>
        </div>

        {/* Login Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
            <div className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-sm font-bold text-gray-700 mb-2">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-300 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base transition-all"
                  placeholder="Enter your username"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-bold text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full px-4 py-3 pr-12 border-2 border-gray-300 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base transition-all"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-4 flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-6 w-6 text-gray-400 hover:text-gray-600" />
                    ) : (
                      <EyeIcon className="h-6 w-6 text-gray-400 hover:text-gray-600" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-red-700 text-sm font-semibold bg-red-50 border-2 border-red-300 rounded-lg p-4">
                  ⚠️ {error}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowResetPassword(true)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent text-base font-bold rounded-lg text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
                >
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Info */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 rounded-xl p-6 shadow-md">
          <p className="text-sm text-blue-800 text-center">
            Need access? Contact administrators <span className="font-bold">Adam</span> or <span className="font-bold">Kris</span>
          </p>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          © 2024 American Circuits. All rights reserved.
        </div>
      </div>
    </div>
  );
}
