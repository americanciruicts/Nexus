'use client';

import Layout from '@/components/layout/Layout';
import { ChartBarIcon, DocumentChartBarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState('week');
  const [reportType, setReportType] = useState('production');

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white shadow-md rounded-xl p-6 border border-gray-100">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Reports & Analytics</h1>
              <p className="text-gray-600 mt-1">Manufacturing performance insights and metrics</p>
            </div>
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-md">
              Export Report
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow-md rounded-xl p-6 border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Report Type</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              >
                <option value="production">Production Summary</option>
                <option value="labor">Labor Analysis</option>
                <option value="quality">Quality Metrics</option>
                <option value="efficiency">Efficiency Report</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Date Range</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              >
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="year">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Work Center</label>
              <select className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all">
                <option>All Work Centers</option>
                <option>ASSEMBLY</option>
                <option>SOLDERING</option>
                <option>TESTING</option>
                <option>QC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border-2 border-blue-200 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Total Travelers</p>
                <p className="text-4xl font-bold text-blue-900 mt-2">124</p>
                <p className="text-sm text-blue-600 mt-1">+12% from last week</p>
              </div>
              <DocumentChartBarIcon className="h-14 w-14 text-blue-600 opacity-80" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700 uppercase tracking-wide">Completed</p>
                <p className="text-4xl font-bold text-green-900 mt-2">98</p>
                <p className="text-sm text-green-600 mt-1">79% completion rate</p>
              </div>
              <ChartBarIcon className="h-14 w-14 text-green-600 opacity-80" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-6 border-2 border-yellow-200 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-yellow-700 uppercase tracking-wide">Labor Hours</p>
                <p className="text-4xl font-bold text-yellow-900 mt-2">1,256</p>
                <p className="text-sm text-yellow-600 mt-1">This week</p>
              </div>
              <ClockIcon className="h-14 w-14 text-yellow-600 opacity-80" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border-2 border-purple-200 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-purple-700 uppercase tracking-wide">Efficiency</p>
                <p className="text-4xl font-bold text-purple-900 mt-2">94%</p>
                <p className="text-sm text-purple-600 mt-1">+3% improvement</p>
              </div>
              <UserGroupIcon className="h-14 w-14 text-purple-600 opacity-80" />
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Production Chart */}
          <div className="bg-white shadow-md rounded-xl p-6 border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Production by Work Center</h3>
            <div className="space-y-4">
              {[
                { name: 'ASSEMBLY', value: 85, color: 'bg-blue-500' },
                { name: 'SOLDERING', value: 72, color: 'bg-green-500' },
                { name: 'TESTING', value: 91, color: 'bg-yellow-500' },
                { name: 'QC', value: 88, color: 'bg-purple-500' },
                { name: 'PACKAGING', value: 78, color: 'bg-pink-500' }
              ].map((item) => (
                <div key={item.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold text-gray-700">{item.name}</span>
                    <span className="font-bold text-gray-900">{item.value}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`${item.color} h-3 rounded-full transition-all duration-500`}
                      style={{ width: `${item.value}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quality Metrics */}
          <div className="bg-white shadow-md rounded-xl p-6 border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Quality Metrics</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg border border-green-200">
                <div>
                  <p className="text-sm font-semibold text-green-700">Pass Rate</p>
                  <p className="text-3xl font-bold text-green-900">96.5%</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-green-600 bg-green-200 px-3 py-1 rounded-full">
                    +2.3%
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg border border-red-200">
                <div>
                  <p className="text-sm font-semibold text-red-700">Defect Rate</p>
                  <p className="text-3xl font-bold text-red-900">3.5%</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-red-600 bg-red-200 px-3 py-1 rounded-full">
                    -0.5%
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="text-sm font-semibold text-blue-700">Rework Rate</p>
                  <p className="text-3xl font-bold text-blue-900">2.1%</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-blue-600 bg-blue-200 px-3 py-1 rounded-full">
                    -1.2%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Report Table */}
        <div className="bg-white shadow-md rounded-xl overflow-hidden border border-gray-100">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-blue-100 border-b-2 border-blue-200">
            <h2 className="text-xl font-bold text-blue-900">Detailed Production Report</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Job Number</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Part Number</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Work Center</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Labor Hours</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Completion</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {[
                  { job: '8414L', part: 'METSHIFT', qty: 250, wc: 'ASSEMBLY', hours: 12.5, status: 'In Progress', completion: 75 },
                  { job: '7523C', part: 'CABLE-6IN', qty: 100, wc: 'TESTING', hours: 8.2, status: 'QC', completion: 90 },
                  { job: '9841P', part: 'PCB-MAIN', qty: 500, wc: 'SOLDERING', hours: 18.7, status: 'In Progress', completion: 45 },
                  { job: '5629M', part: 'MECH-HOUSING', qty: 75, wc: 'PACKAGING', hours: 6.3, status: 'Completed', completion: 100 }
                ].map((item) => (
                  <tr key={item.job} className="hover:bg-blue-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{item.job}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{item.part}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{item.qty}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                        {item.wc}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{item.hours}h</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        item.status === 'Completed' ? 'bg-green-100 text-green-800' :
                        item.status === 'QC' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center">
                        <div className="w-24 bg-gray-200 rounded-full h-2.5 mr-2">
                          <div
                            className={`h-2.5 rounded-full ${
                              item.completion === 100 ? 'bg-green-500' :
                              item.completion >= 50 ? 'bg-yellow-500' :
                              'bg-blue-500'
                            }`}
                            style={{ width: `${item.completion}%` }}
                          ></div>
                        </div>
                        <span className="font-semibold text-gray-900">{item.completion}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
