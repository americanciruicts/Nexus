'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { UserCircleIcon, BellIcon, Cog6ToothIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import BarcodeScanner from '../BarcodeScanner';

export default function Header() {
  const [currentUser] = useState({
    name: 'John Doe',
    role: 'Operator',
    avatar: null
  });
  const [showScanner, setShowScanner] = useState(false);

  const handleScanResult = (result: { traveler_id: string; barcode: string }) => {
    console.log('Scan result:', result);
    // Navigate to traveler details
    window.location.href = `/travelers/${result.traveler_id}`;
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
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
            <button className="p-2 text-gray-400 hover:text-gray-600">
              <Cog6ToothIcon className="h-6 w-6" />
            </button>

            {/* User Profile */}
            <div className="flex items-center space-x-2">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{currentUser.name}</p>
                <p className="text-xs text-gray-500">{currentUser.role}</p>
              </div>
              <button className="flex-shrink-0">
                <UserCircleIcon className="h-8 w-8 text-gray-400" />
              </button>
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