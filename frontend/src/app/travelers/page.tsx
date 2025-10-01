'use client';

import { useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { PlusIcon, EyeIcon, PencilIcon, QrCodeIcon, PrinterIcon } from '@heroicons/react/24/outline';

export default function TravelersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [customerFilter, setCustomerFilter] = useState('All Customers');

  // Mock data for travelers - ONLY ACME ONE
  const travelers = [
    {
      id: '8414L',
      jobNumber: '8414L',
      partNumber: 'METSHIFT',
      description: 'METSHIFT Assembly',
      revision: 'V0.2',
      quantity: 250,
      customerCode: 'MEDSHIFT',
      customerName: 'ACME Corporation',
      status: 'IN_PROGRESS',
      currentStep: 'WAVE SOLDER',
      progress: 75,
      createdAt: '2024-01-15',
      dueDate: '2024-01-25',
      specs: 'Lead-free assembly, RoHS compliant',
      fromStock: '',
      toStock: '',
      shipVia: '',
      comments: ''
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return 'bg-yellow-100 text-yellow-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'ON_HOLD':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500';
    if (progress >= 50) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  const handleGenerateBarcode = (travelerId: string) => {
    const barcodeId = `TRV-${travelerId}-${Date.now()}`;
    alert(`✅ Barcode Generated Successfully!\n\n` +
          `Traveler ID: ${travelerId}\n` +
          `Barcode: ${barcodeId}\n\n` +
          `This barcode can be scanned to track and identify the traveler throughout the manufacturing process.`);
  };

  const handlePrintTraveler = (travelerId: string) => {
    alert(`🖨️ Printing Traveler #${travelerId}...\n\nThe traveler document is being sent to the printer.`);
    // In production, this would open a print dialog or send to printer
    window.open(`/travelers/${travelerId}`, '_blank');
  };

  // Filter travelers based on search and filters
  const filteredTravelers = travelers.filter(traveler => {
    const matchesSearch = searchTerm === '' ||
      traveler.jobNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      traveler.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      traveler.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'All Statuses' ||
      traveler.status === statusFilter.toUpperCase().replace(' ', '_');

    const matchesCustomer = customerFilter === 'All Customers' ||
      traveler.customerName === customerFilter;

    return matchesSearch && matchesStatus && matchesCustomer;
  });

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg rounded-xl p-6 border border-blue-500">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Travelers</h1>
              <p className="text-blue-100">Manage manufacturing travelers and work orders</p>
            </div>
            <Link
              href="/travelers/new"
              className="bg-white hover:bg-blue-50 text-blue-700 flex items-center space-x-2 px-6 py-3 rounded-lg font-semibold shadow-md transition-all transform hover:-translate-y-1"
            >
              <PlusIcon className="h-5 w-5" />
              <span>New Traveler</span>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Filter & Search</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              >
                <option>All Statuses</option>
                <option>In Progress</option>
                <option>Completed</option>
                <option>On Hold</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Customer</label>
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              >
                <option>All Customers</option>
                <option>ACME Corporation</option>
                <option>TechCorp Inc</option>
                <option>Electronics Plus</option>
                <option>Industrial Solutions</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Date Range</label>
              <input
                type="date"
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Job #, Part #, Description..."
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Travelers List */}
        <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
          <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b-2 border-blue-200">
            <h2 className="text-xl font-bold text-gray-900">
              Active Travelers ({filteredTravelers.length} of {travelers.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Job #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Part Info
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Progress
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTravelers.map((traveler) => (
                  <tr key={traveler.id} className="hover:bg-blue-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{traveler.jobNumber}</div>
                      <div className="text-sm text-gray-500">Created: {traveler.createdAt}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{traveler.partNumber}</div>
                      <div className="text-sm text-gray-500">{traveler.description}</div>
                      <div className="text-sm text-gray-500">Rev: {traveler.revision} | Qty: {traveler.quantity}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{traveler.customerName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(traveler.status)}`}>
                        {traveler.status.replace('_', ' ')}
                      </span>
                      <div className="text-sm text-gray-500 mt-1">{traveler.currentStep}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                          <div
                            className={`h-2 rounded-full ${getProgressColor(traveler.progress)}`}
                            style={{ width: `${traveler.progress}%` }}
                          ></div>
                        </div>
                        <span className="text-sm text-gray-900">{traveler.progress}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {traveler.dueDate}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <Link
                          href={`/travelers/${traveler.id}`}
                          className="text-blue-600 hover:text-blue-900 transition-colors"
                          title="View Details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </Link>
                        <Link
                          href={`/travelers/${traveler.id}/edit`}
                          className="text-yellow-600 hover:text-yellow-900 transition-colors"
                          title="Edit"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </Link>
                        <button
                          onClick={() => handlePrintTraveler(traveler.id)}
                          className="text-green-600 hover:text-green-900 transition-colors"
                          title="Print Traveler"
                        >
                          <PrinterIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleGenerateBarcode(traveler.id)}
                          className="text-purple-600 hover:text-purple-900 transition-colors"
                          title="Generate Barcode"
                        >
                          <QrCodeIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 shadow-lg rounded-xl p-6 border-2 border-blue-200">
            <h3 className="text-lg font-bold text-blue-900 mb-4">Production Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700 font-semibold">In Progress:</span>
                <span className="text-lg font-bold text-blue-900">3</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700 font-semibold">Completed:</span>
                <span className="text-lg font-bold text-blue-900">1</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700 font-semibold">Total Parts:</span>
                <span className="text-lg font-bold text-blue-900">925</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 shadow-lg rounded-xl p-6 border-2 border-green-200">
            <h3 className="text-lg font-bold text-green-900 mb-4">This Week</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-700 font-semibold">Started:</span>
                <span className="text-lg font-bold text-green-900">4</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-700 font-semibold">Completed:</span>
                <span className="text-lg font-bold text-green-900">2</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-700 font-semibold">Labor Hours:</span>
                <span className="text-lg font-bold text-green-900">156.5</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-orange-100 shadow-lg rounded-xl p-6 border-2 border-orange-200">
            <h3 className="text-lg font-bold text-orange-900 mb-4">Upcoming Due</h3>
            <div className="space-y-3">
              <div className="p-3 bg-white rounded-lg border border-orange-200">
                <div className="font-bold text-gray-900 text-sm">Job #7523C</div>
                <div className="text-orange-700 text-sm font-semibold">Due: Tomorrow</div>
              </div>
              <div className="p-3 bg-white rounded-lg border border-orange-200">
                <div className="font-bold text-gray-900 text-sm">Job #8414L</div>
                <div className="text-orange-700 text-sm font-semibold">Due: In 3 days</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
