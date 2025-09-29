import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { DocumentTextIcon, ClockIcon, ChartBarIcon, UserGroupIcon } from '@heroicons/react/24/outline';

export default function Dashboard() {
  return (
    <Layout>
      <div className="space-y-6">
        {/* Dashboard Header */}
        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard</h1>
          <p className="text-gray-600">Manufacturing Operations Overview</p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentTextIcon className="h-8 w-8 text-blue-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Travelers</dt>
                    <dd className="text-3xl font-bold text-gray-900">24</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ClockIcon className="h-8 w-8 text-yellow-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Hours This Week</dt>
                    <dd className="text-3xl font-bold text-gray-900">156.5</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ChartBarIcon className="h-8 w-8 text-green-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Completed Today</dt>
                    <dd className="text-3xl font-bold text-gray-900">8</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <UserGroupIcon className="h-8 w-8 text-purple-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Workers</dt>
                    <dd className="text-3xl font-bold text-gray-900">12</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/travelers/new" className="bg-blue-50 hover:bg-blue-100 p-4 rounded-lg border border-blue-200 transition-colors">
              <div className="text-center">
                <DocumentTextIcon className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <h3 className="font-medium text-blue-900">Create New Traveler</h3>
                <p className="text-sm text-blue-600">Start a new manufacturing process</p>
              </div>
            </Link>

            <Link href="/labor-tracking" className="bg-yellow-50 hover:bg-yellow-100 p-4 rounded-lg border border-yellow-200 transition-colors">
              <div className="text-center">
                <ClockIcon className="h-8 w-8 text-yellow-600 mx-auto mb-2" />
                <h3 className="font-medium text-yellow-900">Clock In/Out</h3>
                <p className="text-sm text-yellow-600">Track labor time</p>
              </div>
            </Link>

            <Link href="/reports" className="bg-purple-50 hover:bg-purple-100 p-4 rounded-lg border border-purple-200 transition-colors">
              <div className="text-center">
                <ChartBarIcon className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                <h3 className="font-medium text-purple-900">View Reports</h3>
                <p className="text-sm text-purple-600">Analytics and insights</p>
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