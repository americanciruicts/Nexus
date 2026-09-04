'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Layout from '@/components/layout/Layout';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import {
  WrenchScrewdriverIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  PCB_ASSEMBLY_WORK_CENTERS,
  PCB_WORK_CENTERS,
  CABLES_WORK_CENTERS,
  PURCHASING_WORK_CENTERS,
  RMA_WORK_CENTERS,
  MODIFICATION_WORK_CENTERS,
  DEPARTMENT_COLORS,
  parseDepartments,
  getDepartmentColor,
} from '@/data/workCenters';

// Inline arrow SVGs - heroicons ArrowUp/ArrowDown fail to bundle in this project
const ArrowUpSVG = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "h-4 w-4"}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
  </svg>
);

const ArrowDownSVG = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={className || "h-4 w-4"}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

interface WorkCenterDB {
  id: number;
  name: string;
  code: string;
  description: string;
  traveler_type: string | null;
  category: string | null;
  department: string | null;
  sort_order: number;
  is_active: boolean;
}

const CATEGORY_OPTIONS = [
  '',
  'SMT hrs. Actual',
  'HAND hrs. Actual',
  'TH hrs. Actual',
  'AOI & Final Inspection, QC hrs. Actual',
  'E-TEST hrs. Actual',
  'Labelling, Packaging, Shipping hrs. Actual',
];

const TABS = [
  { key: 'PCB_ASSEMBLY', label: 'PCB Assembly' },
  { key: 'PCB', label: 'PCB' },
  { key: 'CABLE', label: 'Cables' },
  { key: 'PURCHASING', label: 'Purchasing' },
  { key: 'RMA_SAME', label: 'RMA Same Job' },
  { key: 'RMA_DIFF', label: 'RMA Diff Job' },
  { key: 'MODIFICATION', label: 'Modification, Rework or Repair' },
];

// Static data map for initial sync
const STATIC_DATA: Record<string, { name: string; description: string; department?: string }[]> = {
  PCB_ASSEMBLY: PCB_ASSEMBLY_WORK_CENTERS,
  PCB: PCB_WORK_CENTERS,
  CABLE: CABLES_WORK_CENTERS,
  PURCHASING: PURCHASING_WORK_CENTERS,
  RMA_SAME: RMA_WORK_CENTERS,
  RMA_DIFF: RMA_WORK_CENTERS,
  MODIFICATION: MODIFICATION_WORK_CENTERS,
};

export default function WorkCenterManagementPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('PCB_ASSEMBLY');
  const [searchTerm, setSearchTerm] = useState('');
  const [workCenters, setWorkCenters] = useState<WorkCenterDB[]>([]);
  const [allWorkCenters, setAllWorkCenters] = useState<WorkCenterDB[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedWC, setSelectedWC] = useState<WorkCenterDB | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '', category: '', department: '', traveler_type: 'PCB_ASSEMBLY', sort_order: '' });
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const fetchWorkCenters = async () => {
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/?include_inactive=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setAllWorkCenters(data);

        // If DB is empty, sync from static data
        if (data.length === 0) {
          await syncStaticData();
          return;
        }
      }
    } catch (error) {
      console.error('Error fetching work centers:', error);
      // Fallback to static data display
      loadStaticFallback();
    } finally {
      setLoading(false);
    }
  };

  const loadStaticFallback = () => {
    const staticItems: WorkCenterDB[] = [];
    let idCounter = 1;
    Object.entries(STATIC_DATA).forEach(([type, items]) => {
      items.forEach((item, idx) => {
        staticItems.push({
          id: idCounter++,
          name: item.name,
          code: `${type}_${item.name.replace(/\s+/g, '_').replace(/\//g, '_').replace(/&/g, 'AND').toUpperCase()}`,
          description: item.description,
          traveler_type: type,
          category: null,
          department: item.department || null,
          sort_order: idx + 1,
          is_active: true,
        });
      });
    });
    setAllWorkCenters(staticItems);
  };

  const syncStaticData = async () => {
    const token = localStorage.getItem('nexus_token');
    let synced = 0;

    for (const [type, items] of Object.entries(STATIC_DATA)) {
      for (const item of items) {
        try {
          const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: item.name,
              code: `${type}_${item.name.replace(/\s+/g, '_').replace(/\//g, '_').replace(/&/g, 'AND').toUpperCase()}`,
              description: item.description,
              traveler_type: type,
              is_active: true
            })
          });
          if (response.ok) synced++;
        } catch {
          // Skip duplicates
        }
      }
    }

    if (synced > 0) {
      toast.success(`Synced ${synced} work centers from default data`);
    }

    // Re-fetch after sync
    const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/?include_inactive=true`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('nexus_token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      setAllWorkCenters(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWorkCenters();
  }, []);

  // Filter work centers by active tab and search
  useEffect(() => {
    let filtered = allWorkCenters.filter(wc => wc.traveler_type === activeTab);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(wc =>
        wc.name.toLowerCase().includes(q) ||
        wc.description?.toLowerCase().includes(q) ||
        wc.code.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => a.sort_order - b.sort_order);
    setWorkCenters(filtered);
  }, [allWorkCenters, activeTab, searchTerm]);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      toast.error('Work center name is required');
      return;
    }
    try {
      const token = localStorage.getItem('nexus_token');
      const travelerType = formData.traveler_type || activeTab;
      const code = `${travelerType}_${(formData.code || formData.name).replace(/\s+/g, '_').replace(/\//g, '_').replace(/&/g, 'AND').toUpperCase()}`;
      const sortOrder = formData.sort_order ? parseInt(formData.sort_order) : null;
      const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          code: code,
          description: formData.description,
          traveler_type: travelerType,
          category: formData.category || null,
          department: formData.department || null,
          sort_order: sortOrder,
          is_active: true
        })
      });

      if (response.ok) {
        setIsAddModalOpen(false);
        setFormData({ name: '', code: '', description: '', category: '', department: '', traveler_type: activeTab, sort_order: '' });
        toast.success(`Work center "${formData.name}" added successfully`);
        // Re-fetch to get updated sort orders
        fetchWorkCenters();
      } else {
        const err = await response.json();
        toast.error(err.detail || 'Failed to add work center');
      }
    } catch {
      toast.error('Error adding work center');
    }
  };

  const handleEdit = async () => {
    if (!selectedWC || !formData.name.trim()) return;
    try {
      const token = localStorage.getItem('nexus_token');
      const sortOrder = formData.sort_order ? parseInt(formData.sort_order) : undefined;
      const body: Record<string, unknown> = {
        name: formData.name,
        description: formData.description,
        category: formData.category || null,
        department: formData.department || null,
        traveler_type: formData.traveler_type || selectedWC.traveler_type,
      };
      if (sortOrder !== undefined) body.sort_order = sortOrder;
      const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/${selectedWC.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        const updated = await response.json();
        setAllWorkCenters(prev => prev.map(wc => wc.id === updated.id ? updated : wc));
        setIsEditModalOpen(false);
        setSelectedWC(null);
        toast.success(`Work center "${formData.name}" updated`);
      } else {
        const err = await response.json();
        toast.error(err.detail || 'Failed to update work center');
      }
    } catch {
      toast.error('Error updating work center');
    }
  };

  const handleDelete = async () => {
    if (!selectedWC) return;
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/${selectedWC.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        setAllWorkCenters(prev => prev.filter(wc => wc.id !== selectedWC.id));
        setIsDeleteModalOpen(false);
        setSelectedWC(null);
        toast.success(`Work center deleted`);
      } else {
        const err = await response.json();
        toast.error(err.detail || 'Failed to delete work center');
      }
    } catch {
      toast.error('Error deleting work center');
    }
  };

  const openEditModal = (wc: WorkCenterDB) => {
    setSelectedWC(wc);
    setFormData({ name: wc.name, code: wc.code, description: wc.description || '', category: wc.category || '', department: wc.department || '', traveler_type: wc.traveler_type || activeTab, sort_order: String(wc.sort_order) });
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (wc: WorkCenterDB) => {
    setSelectedWC(wc);
    setIsDeleteModalOpen(true);
  };

  // Move work center up or down and renumber sequentially
  const handleMove = async (wcId: number, direction: 'up' | 'down') => {
    // Get the filtered list for the active tab sorted by sort_order
    const tabItems = allWorkCenters
      .filter(wc => wc.traveler_type === activeTab)
      .sort((a, b) => a.sort_order - b.sort_order);

    const currentIdx = tabItems.findIndex(wc => wc.id === wcId);
    if (currentIdx < 0) return;
    const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
    if (swapIdx < 0 || swapIdx >= tabItems.length) return;

    // Swap in array
    const newItems = [...tabItems];
    [newItems[currentIdx], newItems[swapIdx]] = [newItems[swapIdx], newItems[currentIdx]];

    // Renumber sequentially 1, 2, 3...
    const reorderPayload = newItems.map((wc, idx) => ({ id: wc.id, sort_order: idx + 1 }));

    // Optimistic update
    const updatedAll = allWorkCenters.map(wc => {
      const match = reorderPayload.find(r => r.id === wc.id);
      return match ? { ...wc, sort_order: match.sort_order } : wc;
    });
    setAllWorkCenters(updatedAll);

    // Save to backend
    try {
      const token = localStorage.getItem('nexus_token');
      await fetch(`${API_BASE_URL}/work-centers-mgmt/reorder`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items: reorderPayload })
      });
    } catch {
      toast.error('Failed to save order');
    }
  };

  const tabCounts = TABS.map(tab => ({
    ...tab,
    count: allWorkCenters.filter(wc => wc.traveler_type === tab.key).length
  }));

  // Redirect non-admins to dashboard (must be in useEffect, not during render)
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  if (authLoading || !isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout fullWidth>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 flex items-center justify-center">
          <div className="text-xl text-gray-600 dark:text-slate-400">Loading work centers...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <div className="w-full space-y-4 p-4 lg:p-6">
          {/* Header */}
          <div className="bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 shadow-2xl rounded-2xl p-5 md:p-8 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-white/15 backdrop-blur-sm p-3 rounded-xl border border-white/20">
                  <WrenchScrewdriverIcon className="w-7 h-7 text-yellow-300" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                    Work Center Management
                  </h1>
                  <p className="text-sm text-teal-200/80 mt-0.5">
                    Manage work centers for each traveler type ({workCenters.length} work centers)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Search work centers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-4 py-2.5 rounded-xl border-0 w-full sm:w-64 focus:ring-2 focus:ring-white/50 shadow-md text-sm"
                />
                <button
                  onClick={() => { setFormData({ name: '', code: '', description: '', category: '', department: '', traveler_type: activeTab, sort_order: '' }); setIsAddModalOpen(true); }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-100 text-indigo-700 rounded-xl font-bold shadow-lg transition-all text-sm"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Add Work Center</span>
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {tabCounts.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearchTerm(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    activeTab === tab.key ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Work Centers Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 rounded-t-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute top-0 right-0 w-20 h-20 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-14 h-14 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
              </div>
              <div className="relative z-10 flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-white">
                  {TABS.find(t => t.key === activeTab)?.label} Work Centers
                </h2>
                <span className="text-xs font-semibold text-white bg-white/20 px-2 py-0.5 rounded-full">
                  {workCenters.length}
                </span>
              </div>
            </div>

            {(() => {
              return (
                <>
                  {/* Desktop Table View */}
                  <div className="block">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800">
                          <th className="px-4 py-4 text-left text-xs font-extrabold text-white uppercase tracking-wider w-20">#</th>
                          <th className="px-4 py-4 text-center text-xs font-extrabold text-white uppercase tracking-wider w-20">Order</th>
                          <th className="px-6 py-4 text-left text-xs font-extrabold text-white uppercase tracking-wider">Work Center</th>
                          <th className="px-6 py-4 text-left text-xs font-extrabold text-white uppercase tracking-wider">Description</th>
                          <th className="px-4 py-4 text-left text-xs font-extrabold text-white uppercase tracking-wider">Department</th>
                          <th className="px-4 py-4 text-left text-xs font-extrabold text-white uppercase tracking-wider">Category</th>
                          <th className="px-6 py-4 text-right text-xs font-extrabold text-white uppercase tracking-wider w-32">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                        {workCenters.map((wc, index) => {
                          const isFirst = index === 0;
                          const isLast = index === workCenters.length - 1;
                          return (
                            <tr key={wc.id} className="hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                              <td className="px-4 py-3">
                                <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                                  {index + 1}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => handleMove(wc.id, 'up')}
                                    disabled={isFirst}
                                    className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 rounded-md disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                    title="Move Up"
                                  >
                                    <ArrowUpSVG className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleMove(wc.id, 'down')}
                                    disabled={isLast}
                                    className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-800 border border-blue-200 rounded-md disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                    title="Move Down"
                                  >
                                    <ArrowDownSVG className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                              <td className="px-6 py-3">
                                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{wc.name}</span>
                              </td>
                              <td className="px-6 py-3">
                                <span className="text-sm text-gray-600 dark:text-slate-400">{wc.description}</span>
                              </td>
                              <td className="px-4 py-3">
                                {wc.department ? (
                                  <div className="flex flex-wrap gap-1">
                                    {parseDepartments(wc.department).map((dept, i) => {
                                      const colors = getDepartmentColor(dept);
                                      return (
                                        <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colors.bg} ${colors.text} ${colors.border}`}>
                                          {dept}
                                        </span>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {wc.category ? (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                                    wc.category.includes('SMT') ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    wc.category.includes('HAND') ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                    wc.category.includes('TH') ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                    wc.category.includes('AOI') ? 'bg-green-50 text-green-700 border-green-200' :
                                    wc.category.includes('E-TEST') ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                    wc.category.includes('Labelling') ? 'bg-teal-50 text-teal-700 border-teal-200' :
                                    'bg-gray-50 text-gray-700 border-gray-200'
                                  }`}>
                                    {wc.category}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-6 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => openEditModal(wc)}
                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Edit"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => openDeleteModal(wc)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {workCenters.length === 0 && (
                    <div className="text-center py-12">
                      <WrenchScrewdriverIcon className="mx-auto h-12 w-12 text-gray-400 dark:text-slate-500" />
                      <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-slate-100">No work centers found</h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Add a new work center or try a different search term.</p>
                    </div>
                  )}

                  {/* Bottom Bar */}
                  <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 relative overflow-hidden rounded-b-xl">
                    <div className="absolute inset-0 opacity-10 pointer-events-none">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                      <div className="absolute bottom-0 left-0 w-12 h-12 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
                    </div>
                    <div className="relative z-10 flex items-center justify-between">
                      <span className="text-xs text-white/80">
                        Showing all {workCenters.length} work centers
                      </span>
                      <span className="text-xs text-white/80 font-medium">
                        {TABS.find(t => t.key === activeTab)?.label}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Add Work Center Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Add Work Center</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
                <XMarkIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., WAVE SOLDER"
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description"
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Traveler Type</label>
                <select
                  value={formData.traveler_type}
                  onChange={(e) => setFormData({ ...formData, traveler_type: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  {TABS.map(tab => (
                    <option key={tab.key} value={tab.key}>{tab.label}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Department</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => { setFormData({ ...formData, department: e.target.value }); setDeptDropdownOpen(true); }}
                    onFocus={() => setDeptDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setDeptDropdownOpen(false), 200)}
                    placeholder="Select or type a department..."
                    className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                  {deptDropdownOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-700 border-2 border-gray-300 dark:border-slate-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {Object.keys(DEPARTMENT_COLORS).filter(d => d !== 'Other' && d.toLowerCase().includes(formData.department.toLowerCase())).map(dept => (
                        <button
                          key={dept}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setFormData({ ...formData, department: dept }); setDeptDropdownOpen(false); }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-600 text-gray-900 dark:text-slate-100"
                        >
                          {dept}
                        </button>
                      ))}
                      {formData.department && !Object.keys(DEPARTMENT_COLORS).some(d => d.toLowerCase() === formData.department.toLowerCase()) && (
                        <div className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 border-t border-gray-200 dark:border-slate-600">
                          Press Enter or click away to use &quot;{formData.department}&quot; as custom department
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  <option value="">No Category</option>
                  {CATEGORY_OPTIONS.filter(c => c).map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1"># Position (Sort Order)</label>
                <input
                  type="number"
                  min="1"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                  placeholder="Leave empty to add at the end"
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Enter the position number where this work center should appear. Existing items will shift down.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 rounded-lg font-semibold">
                Cancel
              </button>
              <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
                Add Work Center
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Work Center Modal */}
      {isEditModalOpen && selectedWC && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Edit Work Center</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
                <XMarkIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Traveler Type</label>
                <select
                  value={formData.traveler_type}
                  onChange={(e) => setFormData({ ...formData, traveler_type: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  {TABS.map(tab => (
                    <option key={tab.key} value={tab.key}>{tab.label}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Department</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => { setFormData({ ...formData, department: e.target.value }); setDeptDropdownOpen(true); }}
                    onFocus={() => setDeptDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setDeptDropdownOpen(false), 200)}
                    placeholder="Select or type a department..."
                    className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                  {deptDropdownOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-700 border-2 border-gray-300 dark:border-slate-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {Object.keys(DEPARTMENT_COLORS).filter(d => d !== 'Other' && d.toLowerCase().includes(formData.department.toLowerCase())).map(dept => (
                        <button
                          key={dept}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setFormData({ ...formData, department: dept }); setDeptDropdownOpen(false); }}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-600 text-gray-900 dark:text-slate-100"
                        >
                          {dept}
                        </button>
                      ))}
                      {formData.department && !Object.keys(DEPARTMENT_COLORS).some(d => d.toLowerCase() === formData.department.toLowerCase()) && (
                        <div className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 border-t border-gray-200 dark:border-slate-600">
                          Press Enter or click away to use &quot;{formData.department}&quot; as custom department
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  <option value="">No Category</option>
                  {CATEGORY_OPTIONS.filter(c => c).map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-1"># Position (Sort Order)</label>
                <input
                  type="number"
                  min="1"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                  placeholder="Current position"
                  className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Change the position number to reorder this work center.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 rounded-lg font-semibold">
                Cancel
              </button>
              <button onClick={handleEdit} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && selectedWC && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2">Delete Work Center</h3>
            <p className="text-gray-600 dark:text-slate-400 mb-6">
              Are you sure you want to delete <strong>{selectedWC.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 rounded-lg font-semibold">
                Cancel
              </button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
