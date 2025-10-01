'use client';

import { useState, useEffect } from 'react';
import Layout from '@/components/layout/Layout';
import {
  PlayIcon,
  StopIcon,
  ClockIcon,
  DocumentTextIcon,
  UserIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';

interface LaborEntry {
  id: number;
  traveler_id: number;
  step_id?: number;
  employee_id: number;
  employee_name: string;
  start_time: string;
  end_time?: string;
  hours_worked: number;
  description: string;
  is_completed: boolean;
  created_at: string;
}

interface ActiveEntry {
  id: number;
  traveler_id: number;
  description: string;
  start_time: string;
  elapsed_hours: number;
}

export default function LaborTracking() {
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | null>(null);
  const [recentEntries, setRecentEntries] = useState<LaborEntry[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [currentUser] = useState({ name: 'John Doe', id: 1 });

  // Form states for starting new labor entry
  const [newEntry, setNewEntry] = useState({
    traveler_id: '',
    job_number: '',
    description: '',
    search_query: ''
  });

  const [laborSummary, setLaborSummary] = useState({
    total_hours: 0,
    total_entries: 0,
    completed_entries: 0,
    active_entries: 0,
    completion_rate: 0
  });

  const [travelers] = useState([
    { id: 1, job_number: '8414L', part_number: 'METSHIFT', part_description: 'METSHIFT Assembly' },
    { id: 2, job_number: 'WO-001', part_number: 'PCB-001', part_description: 'Main Control Board' },
    { id: 3, job_number: 'WO-002', part_number: 'CABLE-001', part_description: 'Power Cable Assembly' },
  ]);

  useEffect(() => {
    // Load active labor entry
    loadActiveEntry();
    // Load recent entries
    loadRecentEntries();
    // Load labor summary
    loadLaborSummary();

    // Update elapsed time every second if there's an active entry
    const interval = setInterval(() => {
      if (activeEntry) {
        const elapsed = (Date.now() - new Date(activeEntry.start_time).getTime()) / (1000 * 60 * 60);
        setActiveEntry((prev) => prev ? { ...prev, elapsed_hours: elapsed } : null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeEntry?.id, activeEntry]);

  const loadActiveEntry = async () => {
    // Mock API call
    const mockActiveEntry = null; // No active entry for demo
    setActiveEntry(mockActiveEntry);
  };

  const loadRecentEntries = async () => {
    // Mock API call
    const mockEntries: LaborEntry[] = [
      {
        id: 1,
        traveler_id: 1,
        employee_id: 1,
        employee_name: 'John Doe',
        start_time: '2024-01-15T08:00:00Z',
        end_time: '2024-01-15T12:30:00Z',
        hours_worked: 4.5,
        description: 'PCB Assembly - Step 1: Incoming Inspection',
        is_completed: true,
        created_at: '2024-01-15T08:00:00Z'
      },
      {
        id: 2,
        traveler_id: 2,
        employee_id: 1,
        employee_name: 'John Doe',
        start_time: '2024-01-15T13:30:00Z',
        end_time: '2024-01-15T16:15:00Z',
        hours_worked: 2.75,
        description: 'Cable Assembly - Connector Installation',
        is_completed: true,
        created_at: '2024-01-15T13:30:00Z'
      }
    ];
    setRecentEntries(mockEntries);
  };

  const loadLaborSummary = async () => {
    // Mock API call
    const mockSummary = {
      total_hours: 156.5,
      total_entries: 24,
      completed_entries: 22,
      active_entries: 2,
      completion_rate: 91.7
    };
    setLaborSummary(mockSummary);
  };

  const startLaborEntry = async () => {
    if (!newEntry.traveler_id || !newEntry.description) {
      alert('Please select a traveler and enter a description');
      return;
    }

    setIsStarting(true);

    try {
      // Mock API call
      const mockNewEntry: ActiveEntry = {
        id: Date.now(),
        traveler_id: parseInt(newEntry.traveler_id),
        description: newEntry.description,
        start_time: new Date().toISOString(),
        elapsed_hours: 0
      };

      setActiveEntry(mockNewEntry);
      setNewEntry({ traveler_id: '', job_number: '', description: '', search_query: '' });

      alert('Labor entry started successfully!');
    } catch {
      alert('Failed to start labor entry');
    } finally {
      setIsStarting(false);
    }
  };

  const stopLaborEntry = async () => {
    if (!activeEntry) return;

    setIsStopping(true);

    try {
      // Mock API call
      const endTime = new Date().toISOString();
      const hoursWorked = (Date.now() - new Date(activeEntry.start_time).getTime()) / (1000 * 60 * 60);

      // Add to recent entries
      const completedEntry: LaborEntry = {
        id: activeEntry.id,
        traveler_id: activeEntry.traveler_id,
        employee_id: currentUser.id,
        employee_name: currentUser.name,
        start_time: activeEntry.start_time,
        end_time: endTime,
        hours_worked: Math.round(hoursWorked * 100) / 100,
        description: activeEntry.description,
        is_completed: true,
        created_at: activeEntry.start_time
      };

      setRecentEntries([completedEntry, ...recentEntries]);
      setActiveEntry(null);

      alert(`Labor entry completed! Time worked: ${Math.round(hoursWorked * 100) / 100} hours`);

      // Refresh summary
      loadLaborSummary();
    } catch {
      alert('Failed to stop labor entry');
    } finally {
      setIsStopping(false);
    }
  };

  const formatDuration = (hours: number) => {
    const totalMinutes = Math.floor(hours * 60);
    const displayHours = Math.floor(totalMinutes / 60);
    const displayMinutes = totalMinutes % 60;
    return `${displayHours}h ${displayMinutes}m`;
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const filteredTravelers = travelers.filter(traveler =>
    newEntry.search_query === '' ||
    traveler.job_number.toLowerCase().includes(newEntry.search_query.toLowerCase()) ||
    traveler.part_number.toLowerCase().includes(newEntry.search_query.toLowerCase()) ||
    traveler.part_description.toLowerCase().includes(newEntry.search_query.toLowerCase())
  );

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Labor Tracking</h1>
          <p className="text-gray-600">Track time spent on manufacturing processes</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ClockIcon className="h-6 w-6 text-blue-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Hours (Week)</dt>
                    <dd className="text-lg font-medium text-gray-900">{laborSummary.total_hours}h</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentTextIcon className="h-6 w-6 text-green-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Entries</dt>
                    <dd className="text-lg font-medium text-gray-900">{laborSummary.total_entries}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <UserIcon className="h-6 w-6 text-yellow-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Active Entries</dt>
                    <dd className="text-lg font-medium text-gray-900">{laborSummary.active_entries}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ChartBarIcon className="h-6 w-6 text-purple-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Completion Rate</dt>
                    <dd className="text-lg font-medium text-gray-900">{laborSummary.completion_rate}%</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Active Labor Entry */}
        {activeEntry && (
          <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Active Labor Entry</h3>
                  <p className="text-sm text-gray-600">{activeEntry.description}</p>
                  <p className="text-xs text-gray-500">Started: {formatDateTime(activeEntry.start_time)}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-green-600">
                  {formatDuration(activeEntry.elapsed_hours)}
                </div>
                <button
                  onClick={stopLaborEntry}
                  disabled={isStopping}
                  className="mt-2 flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                >
                  <StopIcon className="h-4 w-4" />
                  <span>{isStopping ? 'Stopping...' : 'Stop'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Start New Labor Entry */}
        {!activeEntry && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Start New Labor Entry</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Traveler
                </label>
                <input
                  type="text"
                  value={newEntry.search_query}
                  onChange={(e) => setNewEntry({ ...newEntry, search_query: e.target.value })}
                  placeholder="Search by job number, part number, or description..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Traveler *
                </label>
                <select
                  value={newEntry.traveler_id}
                  onChange={(e) => {
                    const traveler = travelers.find(t => t.id.toString() === e.target.value);
                    setNewEntry({
                      ...newEntry,
                      traveler_id: e.target.value,
                      job_number: traveler?.job_number || ''
                    });
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a traveler</option>
                  {filteredTravelers.map(traveler => (
                    <option key={traveler.id} value={traveler.id}>
                      {traveler.job_number} - {traveler.part_number} ({traveler.part_description})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Work Description *
              </label>
              <textarea
                value={newEntry.description}
                onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                rows={3}
                placeholder="Describe the work you'll be performing..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              onClick={startLaborEntry}
              disabled={isStarting}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
              <PlayIcon className="h-5 w-5" />
              <span>{isStarting ? 'Starting...' : 'Start Labor Entry'}</span>
            </button>
          </div>
        )}

        {/* Recent Labor Entries */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Recent Labor Entries</h3>

            {recentEntries.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No recent labor entries found.</p>
            ) : (
              <div className="space-y-4">
                {recentEntries.map((entry) => (
                  <div key={entry.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <ClockIcon className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatDuration(entry.hours_worked)}
                          </span>
                          <span className="text-sm text-gray-500">
                            {formatDateTime(entry.start_time)} - {entry.end_time ? formatDateTime(entry.end_time) : 'Ongoing'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{entry.description}</p>
                        <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                          <span>Traveler ID: {entry.traveler_id}</span>
                          <span>Employee: {entry.employee_name}</span>
                          <span className={`px-2 py-1 rounded-full ${
                            entry.is_completed
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {entry.is_completed ? 'Completed' : 'In Progress'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}