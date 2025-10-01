'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { UserCircleIcon, BellIcon, Cog6ToothIcon, QrCodeIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';
import BarcodeScanner from '../BarcodeScanner';

export default function Header() {
  const { user, logout } = useAuth();
  const [showScanner, setShowScanner] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleScanResult = (result: { traveler_id: string; barcode: string }) => {
    console.log('Scan result:', result);
    // Navigate to traveler details
    window.location.href = `/travelers/${result.traveler_id}`;
  };

  return (
    <header className="bg-white shadow-md border-b-2 border-blue-100">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Title */}
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0">
              <Image
                src="/logo.jpg"
                alt="American Circuits"
                width={48}
                height={48}
                className="rounded-lg"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">NEXUS</h1>
              <p className="text-sm text-gray-600">Traveler Management System</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex space-x-8">
            <Link href="/dashboard" className="nav-link px-3 py-2 rounded-md text-sm font-medium">
              Dashboard
            </Link>
            <Link href="/travelers" className="nav-link px-3 py-2 rounded-md text-sm font-medium">
              Travelers
            </Link>
            <Link href="/travelers/new" className="nav-link px-3 py-2 rounded-md text-sm font-medium">
              New Traveler
            </Link>
            <Link href="/labor-tracking" className="nav-link px-3 py-2 rounded-md text-sm font-medium">
              Labor Tracking
            </Link>
            <Link href="/reports" className="nav-link px-3 py-2 rounded-md text-sm font-medium">
              Reports
            </Link>
          </nav>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            {/* Barcode Scanner */}
            <button
              onClick={() => setShowScanner(true)}
              className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
              title="Scan Barcode/QR Code"
            >
              <QrCodeIcon className="h-6 w-6" />
            </button>

            {/* Notifications */}
            <button className="relative p-2 text-gray-400 hover:text-gray-600">
              <BellIcon className="h-6 w-6" />
              <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-400 ring-2 ring-white"></span>
            </button>

            {/* Settings */}
            <Link href="/settings" className="p-2 text-gray-400 hover:text-blue-600 transition-colors" title="Settings">
              <Cog6ToothIcon className="h-6 w-6" />
            </Link>

            {/* User Profile */}
            <div className="flex items-center space-x-2 relative">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user?.username || 'Guest'}</p>
                <p className="text-xs text-gray-500">{user?.role || 'No Role'}</p>
              </div>
              <button
                className="flex-shrink-0"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <UserCircleIcon className="h-8 w-8 text-gray-400" />
              </button>

              {/* User Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 top-12 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">{user?.username}</p>
                      <p className="text-xs text-gray-500">{user?.role}</p>
                      {user?.isApprover && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 mt-1">
                          Approver
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        // Add settings functionality here
                      }}
                      className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Cog6ToothIcon className="h-4 w-4 mr-2" />
                      Settings
                    </button>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onScanResult={handleScanResult}
          onClose={() => setShowScanner(false)}
        />
      )}
    </header>
  );
}