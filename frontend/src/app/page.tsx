import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { PlusIcon, DocumentTextIcon, ClockIcon, ChartBarIcon } from '@heroicons/react/24/outline';

export default function Home() {
  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to NEXUS</h2>
            <p className="text-gray-600 mb-4">
              American Circuits Manufacturing Traveler Management System
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link href="/travelers/new" className="bg-blue-50 hover:bg-blue-100 p-4 rounded-lg border border-blue-200 transition-colors">
                <div className="flex items-center space-x-3">
                  <PlusIcon className="h-6 w-6 text-blue-600" />
                  <div>
                    <h3 className="font-medium text-blue-900">New Traveler</h3>
                    <p className="text-sm text-blue-600">Create new manufacturing traveler</p>
                  </div>
                </div>
              </Link>

              <Link href="/travelers" className="bg-green-50 hover:bg-green-100 p-4 rounded-lg border border-green-200 transition-colors">
                <div className="flex items-center space-x-3">
                  <DocumentTextIcon className="h-6 w-6 text-green-600" />
                  <div>
                    <h3 className="font-medium text-green-900">View Travelers</h3>
                    <p className="text-sm text-green-600">Manage existing travelers</p>
                  </div>
                </div>
              </Link>

              <Link href="/labor-tracking" className="bg-yellow-50 hover:bg-yellow-100 p-4 rounded-lg border border-yellow-200 transition-colors">
                <div className="flex items-center space-x-3">
                  <ClockIcon className="h-6 w-6 text-yellow-600" />
                  <div>
                    <h3 className="font-medium text-yellow-900">Labor Tracking</h3>
                    <p className="text-sm text-yellow-600">Track time and labor hours</p>
                  </div>
                </div>
              </Link>

              <Link href="/reports" className="bg-purple-50 hover:bg-purple-100 p-4 rounded-lg border border-purple-200 transition-colors">
                <div className="flex items-center space-x-3">
                  <ChartBarIcon className="h-6 w-6 text-purple-600" />
                  <div>
                    <h3 className="font-medium text-purple-900">Reports</h3>
                    <p className="text-sm text-purple-600">View analytics and reports</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentTextIcon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Travelers</dt>
                    <dd className="text-lg font-medium text-gray-900">24</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ClockIcon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Hours This Week</dt>
                    <dd className="text-lg font-medium text-gray-900">156.5</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ChartBarIcon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Completed Today</dt>
                    <dd className="text-lg font-medium text-gray-900">8</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Recent Activity</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-3 border-b border-gray-200">
                <div>
                  <p className="text-sm font-medium text-gray-900">Traveler #8414L created</p>
                  <p className="text-sm text-gray-500">PCB Assembly - METSHIFT Rev: V0.2</p>
                </div>
                <span className="text-sm text-gray-500">2 hours ago</span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-200">
                <div>
                  <p className="text-sm font-medium text-gray-900">Labor entry completed</p>
                  <p className="text-sm text-gray-500">Cable Assembly - 2.5 hours logged</p>
                </div>
                <span className="text-sm text-gray-500">4 hours ago</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Approval requested</p>
                  <p className="text-sm text-gray-500">Traveler modification requires approval</p>
                </div>
                <span className="text-sm text-gray-500">6 hours ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
