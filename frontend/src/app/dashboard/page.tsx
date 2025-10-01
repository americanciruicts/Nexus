import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { DocumentTextIcon, ClockIcon, ChartBarIcon, UserGroupIcon } from '@heroicons/react/24/outline';

export default function Dashboard() {
  return (
    <Layout>
      <div className="space-y-6">
        {/* Dashboard Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg rounded-xl p-8 border border-blue-500">
          <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-blue-100 text-lg">Manufacturing Operations Overview</p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 overflow-hidden shadow-lg rounded-xl border-2 border-blue-200 transform hover:-translate-y-1 transition-all">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <dt className="text-sm font-bold text-blue-700 uppercase tracking-wide mb-2">Active Travelers</dt>
                  <dd className="text-4xl font-bold text-blue-900">24</dd>
                  <p className="text-sm text-blue-600 mt-1">+3 from yesterday</p>
                </div>
                <div className="flex-shrink-0">
                  <DocumentTextIcon className="h-14 w-14 text-blue-600 opacity-80" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 overflow-hidden shadow-lg rounded-xl border-2 border-yellow-200 transform hover:-translate-y-1 transition-all">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <dt className="text-sm font-bold text-yellow-700 uppercase tracking-wide mb-2">Hours This Week</dt>
                  <dd className="text-4xl font-bold text-yellow-900">156.5</dd>
                  <p className="text-sm text-yellow-600 mt-1">Across all shifts</p>
                </div>
                <div className="flex-shrink-0">
                  <ClockIcon className="h-14 w-14 text-yellow-600 opacity-80" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 overflow-hidden shadow-lg rounded-xl border-2 border-green-200 transform hover:-translate-y-1 transition-all">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <dt className="text-sm font-bold text-green-700 uppercase tracking-wide mb-2">Completed Today</dt>
                  <dd className="text-4xl font-bold text-green-900">8</dd>
                  <p className="text-sm text-green-600 mt-1">On schedule</p>
                </div>
                <div className="flex-shrink-0">
                  <ChartBarIcon className="h-14 w-14 text-green-600 opacity-80" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 overflow-hidden shadow-lg rounded-xl border-2 border-purple-200 transform hover:-translate-y-1 transition-all">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <dt className="text-sm font-bold text-purple-700 uppercase tracking-wide mb-2">Active Workers</dt>
                  <dd className="text-4xl font-bold text-purple-900">12</dd>
                  <p className="text-sm text-purple-600 mt-1">Currently clocked in</p>
                </div>
                <div className="flex-shrink-0">
                  <UserGroupIcon className="h-14 w-14 text-purple-600 opacity-80" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link href="/travelers/new" className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 p-6 rounded-xl border-2 border-blue-200 transition-all transform hover:-translate-y-1 hover:shadow-xl">
              <div className="text-center">
                <DocumentTextIcon className="h-12 w-12 text-blue-600 mx-auto mb-3" />
                <h3 className="font-bold text-blue-900 text-lg mb-2">Create New Traveler</h3>
                <p className="text-sm text-blue-700">Start a new manufacturing process</p>
              </div>
            </Link>

            <Link href="/labor-tracking" className="bg-gradient-to-br from-yellow-50 to-yellow-100 hover:from-yellow-100 hover:to-yellow-200 p-6 rounded-xl border-2 border-yellow-200 transition-all transform hover:-translate-y-1 hover:shadow-xl">
              <div className="text-center">
                <ClockIcon className="h-12 w-12 text-yellow-600 mx-auto mb-3" />
                <h3 className="font-bold text-yellow-900 text-lg mb-2">Clock In/Out</h3>
                <p className="text-sm text-yellow-700">Track labor time</p>
              </div>
            </Link>

            <Link href="/reports" className="bg-gradient-to-br from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 p-6 rounded-xl border-2 border-purple-200 transition-all transform hover:-translate-y-1 hover:shadow-xl">
              <div className="text-center">
                <ChartBarIcon className="h-12 w-12 text-purple-600 mx-auto mb-3" />
                <h3 className="font-bold text-purple-900 text-lg mb-2">View Reports</h3>
                <p className="text-sm text-purple-700">Analytics and insights</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Recent Travelers */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Travelers</h3>
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-900">Traveler #8414L</h4>
                    <p className="text-sm text-gray-600">METSHIFT Assembly - Rev V0.2</p>
                    <p className="text-sm text-gray-500">Status: In Progress - WAVE SOLDER</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600">75% Complete</div>
                    <div className="text-xs text-gray-500">Est. completion: 2 hours</div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-900">Traveler #7523C</h4>
                    <p className="text-sm text-gray-600">Cable Assembly - Rev A1.0</p>
                    <p className="text-sm text-gray-500">Status: Quality Check</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-yellow-600">90% Complete</div>
                    <div className="text-xs text-gray-500">Est. completion: 30 minutes</div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-900">Traveler #9841P</h4>
                    <p className="text-sm text-gray-600">PCB Assembly - Rev B2.1</p>
                    <p className="text-sm text-gray-500">Status: Started - ENGINEERING</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-blue-600">15% Complete</div>
                    <div className="text-xs text-gray-500">Est. completion: 6 hours</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}