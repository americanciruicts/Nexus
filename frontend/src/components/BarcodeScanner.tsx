'use client';

import { useState } from 'react';
import { QrCodeIcon, DocumentTextIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface ScanResult {
  traveler_id: string;
  barcode: string;
  type?: string;
}

interface BarcodeScannerProps {
  onScanResult: (result: ScanResult) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScanResult, onClose }: BarcodeScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('manual');

  const handleManualScan = async () => {
    if (!manualInput.trim()) {
      alert('Please enter a barcode or QR code');
      return;
    }

    setIsScanning(true);

    try {
      // Mock API call for demo
      const mockResult: ScanResult = {
        traveler_id: '1',
        barcode: manualInput,
        type: 'PCB'
      };

      setTimeout(() => {
        onScanResult(mockResult);
        setIsScanning(false);
        onClose();
      }, 1000);

    } catch (err) {
      console.error('Scan error:', err);
      alert('Failed to scan barcode');
      setIsScanning(false);
    }
  };

  const startCameraScanning = async () => {
    setScanMode('camera');
    // In a real implementation, you would integrate with a camera scanning library
    // like @zxing/library or quagga2
    alert('Camera scanning would be implemented with a barcode scanning library');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Scan Traveler Code</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Scan Mode Selection */}
          <div className="flex space-x-2">
            <button
              onClick={() => setScanMode('manual')}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md border ${
                scanMode === 'manual'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <DocumentTextIcon className="h-5 w-5" />
              <span>Manual Entry</span>
            </button>
            <button
              onClick={startCameraScanning}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md border ${
                scanMode === 'camera'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <QrCodeIcon className="h-5 w-5" />
              <span>Camera</span>
            </button>
          </div>

          {scanMode === 'manual' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter Barcode or QR Code
              </label>
              <textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                rows={3}
                placeholder="Paste or type the barcode/QR code data here..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supports: NEX-XXXXXX-JOBNUMBER or NEXUS|ID|JOB|PART|AC formats
              </p>
            </div>
          )}

          {scanMode === 'camera' && (
            <div className="text-center py-8">
              <QrCodeIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Camera scanning would appear here</p>
              <p className="text-sm text-gray-400 mt-2">
                In a real implementation, this would show the camera view
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            {scanMode === 'manual' && (
              <button
                onClick={handleManualScan}
                disabled={isScanning || !manualInput.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {isScanning ? 'Scanning...' : 'Scan'}
              </button>
            )}
          </div>

          {/* Examples */}
          <div className="mt-6 p-3 bg-gray-50 rounded-md">
            <p className="text-xs font-medium text-gray-700 mb-2">Example formats:</p>
            <div className="space-y-1 text-xs text-gray-600">
              <div><strong>Barcode:</strong> NEX-000001-8414L</div>
              <div><strong>QR Code:</strong> NEXUS|1|8414L|METSHIFT|AC</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}