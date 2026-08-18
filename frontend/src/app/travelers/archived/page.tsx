'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import {
  ArchiveBoxIcon,
  ArchiveBoxXMarkIcon,
  EyeIcon,
  CheckIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL } from '@/config/api';
import { fetchAllTravelerRows } from '@/lib/travelersApi';

type ArchivedTraveler = {
  id: number;
  job_number: string;
  work_order_number: string;
  part_number: string;
  part_description: string;
  revision: string;
  quantity: number;
  customer_code: string;
  customer_name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function ArchivedTravelersPage() {
  const { user } = useAuth();
  const [travelers, setTravelers] = useState<ArchivedTraveler[]>([]);
  const [selectedTravelers, setSelectedTravelers] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    fetchArchivedTravelers();
  }, []);

  const fetchArchivedTravelers = async () => {
    try {
      // Must page through the whole list: the endpoint's default page size is 50,
      // so filtering a single request hid every archived traveler older than the
      // 50 most recent ones.
      const data = await fetchAllTravelerRows();
      // Filter only archived travelers
      const archivedData = (data as unknown as ArchivedTraveler[]).filter((t) => t.status === 'ARCHIVED');
      setTravelers(archivedData);
    } catch (error) {
      console.error('Error fetching archived travelers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTravelers = travelers.filter(t =>
    t.job_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.part_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.part_description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id: number) => {
    if (selectedTravelers.includes(id)) {
      setSelectedTravelers(selectedTravelers.filter(tid => tid !== id));
    } else {
      setSelectedTravelers([...selectedTravelers, id]);
    }
  };

  const selectAll = () => {
    if (selectedTravelers.length === filteredTravelers.length) {
      setSelectedTravelers([]);
    } else {
      setSelectedTravelers(filteredTravelers.map(t => t.id));
    }
  };

  const restoreSelected = async () => {
    if (selectedTravelers.length === 0) {
      toast.error('Please select travelers to restore');
      return;
    }

    const count = selectedTravelers.length;
    setConfirmModal({
      title: 'Restore Travelers',
      message: `Restore ${count} traveler(s) to active status?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const token = localStorage.getItem('nexus_token');
          await Promise.all(
            selectedTravelers.map(id =>
              fetch(`${API_BASE_URL}/travelers/${id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'CREATED' })
              })
            )
          );

          toast.success(`Restored ${count} traveler(s)!`);
          setSelectedTravelers([]);
          fetchArchivedTravelers();
        } catch (error) {
          console.error('Error restoring travelers:', error);
          toast.error('Failed to restore travelers');
        }
      }
    });
  };

  // There is no permanent delete. Archiving is the end of the line for a
  // traveler: the row and its full history stay in the database so nothing can
  // ever disappear from the system. Restore is the only way back out.

  if (loading) {
    return (
      <Layout fullWidth>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-6 flex items-center justify-center">
          <div className="text-xl text-gray-600 dark:text-slate-400">Loading archived travelers...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-3 sm:p-4 md:p-6">
        {/* Header */}
        <div className="mb-4 sm:mb-6 bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 text-white rounded-2xl p-5 md:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 backdrop-blur-sm p-3 rounded-xl border border-white/20">
                <ArchiveBoxIcon className="w-7 h-7 text-amber-300" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Archived Travelers</h1>
                <p className="text-sm text-teal-200/80 mt-0.5">View and manage archived production travelers</p>
              </div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2 sm:px-6 sm:py-4 border border-white/20 text-center">
              <div className="text-xl sm:text-3xl font-extrabold">{travelers.length}</div>
              <div className="text-[11px] text-blue-200/70 uppercase tracking-wider font-semibold">Total Archived</div>
            </div>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="mb-4 sm:mb-6 bg-white dark:bg-slate-800 rounded-xl shadow-lg border-2 border-gray-200 dark:border-slate-700 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4">
            {/* Back Button */}
            <Link
              href="/travelers"
              className="flex items-center justify-center space-x-2 px-3 sm:px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold shadow-md text-sm sm:text-base"
            >
              <ArrowLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              <span>Back</span>
            </Link>

            {/* Search */}
            <div className="flex-1 min-w-0 sm:min-w-[200px]">
              <input
                type="text"
                placeholder="Search archived travelers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-gray-500 focus:ring-2 focus:ring-gray-200 text-sm sm:text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={selectAll}
                className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold shadow-md text-xs sm:text-sm"
              >
                <CheckIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">{selectedTravelers.length === filteredTravelers.length ? 'Deselect All' : 'Select All'}</span>
                <span className="sm:hidden">All</span>
              </button>

              <button
                onClick={restoreSelected}
                disabled={selectedTravelers.length === 0}
                className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-semibold shadow-md disabled:cursor-not-allowed text-xs sm:text-sm"
              >
                <ArchiveBoxXMarkIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span>Restore ({selectedTravelers.length})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Archived Travelers List */}
        {filteredTravelers.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-12 text-center border-2 border-gray-200 dark:border-slate-700">
            <ArchiveBoxIcon className="h-24 w-24 mx-auto mb-4 text-gray-300 dark:text-slate-600" />
            <h3 className="text-2xl font-bold text-gray-800 dark:text-slate-200 mb-2">No Archived Travelers</h3>
            <p className="text-gray-600 dark:text-slate-400">Archived travelers will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredTravelers.map((traveler) => (
              <div
                key={traveler.id}
                className={`bg-white dark:bg-slate-800 rounded-xl shadow-lg border-2 ${
                  selectedTravelers.includes(traveler.id)
                    ? 'border-gray-500 dark:border-slate-400 ring-4 ring-gray-200 dark:ring-slate-700'
                    : 'border-gray-200 dark:border-slate-700'
                } p-6 transition-all hover:shadow-xl`}
              >
                <div className="flex items-start space-x-4">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedTravelers.includes(traveler.id)}
                    onChange={() => toggleSelect(traveler.id)}
                    className="mt-2 h-6 w-6 text-gray-600 rounded-lg cursor-pointer"
                  />

                  {/* Content */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-3 mb-3">
                          <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{traveler.job_number}</h3>
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border-2 border-gray-300 dark:border-slate-600 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-slate-700 dark:to-slate-700 text-gray-800 dark:text-slate-300 shadow-sm">
                            ARCHIVED
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500 dark:text-slate-400 font-semibold">Part Number</p>
                            <p className="text-gray-900 dark:text-slate-100 font-bold">{traveler.part_number}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-slate-400 font-semibold">Description</p>
                            <p className="text-gray-900 dark:text-slate-100">{traveler.part_description}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-slate-400 font-semibold">Quantity</p>
                            <p className="text-gray-900 dark:text-slate-100 font-bold">{traveler.quantity}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 dark:text-slate-400 font-semibold">BOM Revision</p>
                            <p className="text-gray-900 dark:text-slate-100 font-bold">{traveler.revision}</p>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">
                          <p>Archived: {new Date(traveler.updated_at).toLocaleString()}</p>
                        </div>
                      </div>

                      {/* View Button */}
                      <Link
                        href={`/travelers/${traveler.id}`}
                        className="p-2 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="View"
                      >
                        <EyeIcon className="h-5 w-5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2">{confirmModal.title}</h3>
            <p className="text-gray-600 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
