'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import {
  PlusIcon,
  EyeIcon,
  PencilIcon,
  PrinterIcon,
  TrashIcon,
  DocumentArrowDownIcon,
  CheckIcon,
  FunnelIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronUpDownIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL } from '@/config/api';
import { DEPARTMENT_BAR_COLORS } from '@/data/workCenters';
import { PageHeaderSkeleton, TableSkeleton } from '@/components/ui/LoadingSkeleton';
import { readLiveCache, writeLiveCache, notifyDataUpdated, LIVE_REFRESH_MS } from '@/lib/liveCache';
import { fetchAllTravelerRows } from '@/lib/travelersApi';

const TRAVELERS_CACHE_KEY = 'nexus_travelers_v1';

// Canonical department order for the card's Department Progress chips. Engineering
// is always first, Shipping always last, and the middle follows the same fixed
// order the traveler detail view uses — so every card lists departments the same
// way regardless of per-traveler step sequence. Any department not listed here
// sorts just before Shipping.
const DEPARTMENT_ORDER = [
  'Engineering', 'Engineering/Prep', 'Prep', 'Receiving', 'SMT', 'ALL',
  'Quality', 'TH', 'Soldering', 'Test', 'Coating', 'Cable', 'Purchasing', 'Other',
  'Shipping',
];
const departmentRank = (name: string): number => {
  const i = DEPARTMENT_ORDER.indexOf(name);
  // Unknown departments sit just before Shipping (the always-last entry).
  return i !== -1 ? i : DEPARTMENT_ORDER.length - 1.5;
};

// Toast notification component
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsVisible(false), 4000);
    const removeTimer = setTimeout(() => onClose(), 4500);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-green-500/95' : type === 'error' ? 'bg-red-500/95' : 'bg-blue-500/95';
  const borderColor = type === 'success' ? 'border-green-400' : type === 'error' ? 'border-red-400' : 'border-blue-400';

  return (
    <div
      className="fixed top-4 right-4 z-50 transition-all duration-500"
      style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? 'translateX(0)' : 'translateX(100px)' }}
    >
      <div className={`flex items-center space-x-3 px-6 py-4 rounded-lg shadow-2xl backdrop-blur-md border ${bgColor} ${borderColor} text-white`}>
        {type === 'success' ? <CheckCircleIcon className="h-6 w-6" /> : type === 'error' ? <XCircleIcon className="h-6 w-6" /> : <ExclamationTriangleIcon className="h-6 w-6" />}
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

// Custom Confirm Modal
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ isOpen, title, message, confirmText = 'Confirm', onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-slate-700">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <ExclamationTriangleIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-slate-100">{title}</h3>
        </div>
        <p className="text-gray-600 dark:text-slate-400 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex justify-end space-x-3">
          <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 rounded-lg font-semibold transition-all">Cancel</button>
          <button onClick={onConfirm} className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-all shadow-md">{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return '';
  if (dateStr.includes('/')) return dateStr;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${month}/${day}/${year}`;
  }
  return dateStr;
};

type DeptProgress = {
  department: string;
  total_steps: number;
  completed_steps: number;
  percent_complete: number;
};

type LaborProgress = {
  total_hours: number;
  entries_count: number;
  active_entries: number;
  steps_with_labor: number;
  total_steps: number;
  percent: number;
};

// RMA travelers display their job number combined with the RMA number as
// "<rma> RMA JOB NO <job>" (e.g. "1234 RMA JOB NO 12345-6"), matching the
// format used outside NEXUS. Non-RMA travelers show the plain job number.
const RMA_TRAVELER_TYPES = ['RMA_SAME', 'RMA_DIFF', 'MODIFICATION'];
function formatJobDisplay(travelerType: string, rmaNumber: string, jobNumber: string): string {
  // RMA travelers always render in the combined format, even when the RMA
  // number or job number hasn't been entered yet.
  return RMA_TRAVELER_TYPES.includes(travelerType)
    ? `${rmaNumber} RMA JOB NO ${jobNumber}`.trim()
    : jobNumber;
}

type TravelerItem = {
  id: string;
  dbId: number;
  jobNumber: string;
  rmaNumber: string;
  jobDisplay: string;
  workOrder: string;
  poNumber: string;
  invoiceNumber: string;
  partNumber: string;
  description: string;
  revision: string;  // Traveler Revision
  customerRevision: string;  // Customer Revision
  quantity: number;
  customerCode: string;
  customerName: string;
  travelerType: string;  // PCB_ASSEMBLY, PCB, CABLES, PURCHASING
  status: string;
  currentStep: string;
  progress: number;
  totalSteps: number;
  completedSteps: number;
  departmentProgress: DeptProgress[];
  laborProgress: LaborProgress;
  createdAt: string;
  dueDate: string;
  shipDate: string;
  specs: string;
  fromStock: string;
  toStock: string;
  shipVia: string;
  comments: string;
  isActive: boolean;
  includeLaborHours: boolean;
};

// Traveler type color configuration (no red or pink)
const getTravelerTypeBadge = (type: string) => {
  const typeConfig: Record<string, { bg: string; text: string; border: string; label: string }> = {
    'PCB_ASSEMBLY': { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700', label: 'PCB Assembly' },
    'ASSY': { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-700', label: 'PCB Assembly' },
    'PCB': { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-800 dark:text-green-300', border: 'border-green-300 dark:border-green-700', label: 'PCB' },
    'CABLE': { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-800 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-700', label: 'Cables' },
    'CABLES': { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-800 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-700', label: 'Cables' },
    'PURCHASING': { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700', label: 'Purchasing' },
    'RMA_SAME': { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-800 dark:text-red-300', border: 'border-red-300 dark:border-red-700', label: 'RMA Same Job' },
    'RMA_DIFF': { bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-800 dark:text-pink-300', border: 'border-pink-300 dark:border-pink-700', label: 'RMA Diff Job' },
    'MODIFICATION': { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700', label: 'Modification and Rework' }
  };

  const config = typeConfig[type] || { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-800 dark:text-slate-200', border: 'border-gray-300 dark:border-slate-600', label: type };
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-xs font-bold border ${config.bg} ${config.text} ${config.border}`}>
      {config.label}
    </span>
  );
};

export default function TravelersPageWrapper() {
  return (
    <Suspense fallback={
      <Layout fullWidth>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-3 sm:p-4 md:p-6">
          <PageHeaderSkeleton />
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <TableSkeleton rows={8} cols={6} />
          </div>
        </div>
      </Layout>
    }>
      <TravelersPage />
    </Suspense>
  );
}

function TravelersPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All Statuses');
  const [viewFilter, setViewFilter] = useState<'active' | 'drafts' | 'all'>((searchParams.get('view') as 'active' | 'drafts' | 'all') || 'all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // Per-user default: Abhi lands on the RMA travelers view (All) each time he
  // opens the page. Applied once on load; he can still change the filter after.
  const abhiDefaultRef = useRef(false);
  useEffect(() => {
    if (abhiDefaultRef.current) return;
    if ((user?.username || '').toLowerCase() === 'abhi@americancircuits.com') {
      abhiDefaultRef.current = true;
      setTypeFilter('RMA');
      setViewFilter('all');
    }
  }, [user]);
  const [travelers, setTravelers] = useState<TravelerItem[]>(() => readLiveCache<TravelerItem[]>(TRAVELERS_CACHE_KEY) ?? []);
  // Don't block on a skeleton if we already have last-known data to show.
  const [travelersLoading, setTravelersLoading] = useState(() => (readLiveCache<TravelerItem[]>(TRAVELERS_CACHE_KEY) ?? []).length === 0);
  const lastTravelersJsonRef = useRef<string>('');
  const [selectedTravelers, setSelectedTravelers] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  // 1000 acts as "All" — the list API caps at 200, so this always shows every
  // loaded traveler on a single page.
  const [itemsPerPage, setItemsPerPage] = useState(1000);

  // Sorting
  type SortField = 'jobNumber' | 'partNumber' | 'customerCode' | 'createdAt' | 'dueDate' | 'shipDate' | 'status' | 'quantity' | 'progress';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Load persisted sort on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('travelers_sort');
      if (saved) {
        const { field, direction } = JSON.parse(saved);
        if (field) setSortField(field);
        if (direction === 'asc' || direction === 'desc') setSortDirection(direction);
      }
    } catch {}
  }, []);

  // Persist sort changes
  useEffect(() => {
    try {
      localStorage.setItem('travelers_sort', JSON.stringify({ field: sortField, direction: sortDirection }));
    } catch {}
  }, [sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // sensible default direction per field type
      const desc: SortField[] = ['createdAt', 'dueDate', 'shipDate', 'quantity', 'progress'];
      setSortDirection(desc.includes(field) ? 'desc' : 'asc');
    }
  };

  // Saved filter presets
  interface FilterPreset {
    name: string;
    searchTerm: string;
    statusFilter: string;
    typeFilter: string;
    viewFilter: 'active' | 'drafts' | 'all';
  }
  const [savedFilters, setSavedFilters] = useState<FilterPreset[]>([]);
  const [showSaveFilter, setShowSaveFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  // Load saved filters from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nexus_saved_filters');
      if (stored) setSavedFilters(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const saveCurrentFilter = () => {
    if (!newFilterName.trim()) return;
    const preset: FilterPreset = {
      name: newFilterName.trim(),
      searchTerm,
      statusFilter,
      typeFilter,
      viewFilter,
    };
    const updated = [...savedFilters.filter(f => f.name !== preset.name), preset];
    setSavedFilters(updated);
    localStorage.setItem('nexus_saved_filters', JSON.stringify(updated));
    setNewFilterName('');
    setShowSaveFilter(false);
  };

  const loadFilter = (preset: FilterPreset) => {
    setSearchTerm(preset.searchTerm);
    setStatusFilter(preset.statusFilter);
    setTypeFilter(preset.typeFilter);
    setViewFilter(preset.viewFilter);
  };

  const deleteFilter = (name: string) => {
    const updated = savedFilters.filter(f => f.name !== name);
    setSavedFilters(updated);
    localStorage.setItem('nexus_saved_filters', JSON.stringify(updated));
  };

  // Toast and Confirm Modal state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; confirmText: string; onConfirm: () => void }>({
    isOpen: false, title: '', message: '', confirmText: 'Confirm', onConfirm: () => {}
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info') => setToast({ message, type });
  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmText = 'Confirm') => {
    setConfirmModal({ isOpen: true, title, message, confirmText, onConfirm });
  };
  const closeConfirm = () => setConfirmModal({ ...confirmModal, isOpen: false });

  useEffect(() => {
    fetchTravelers();
    // Live auto-refresh so changes other users make show up within ~30s.
    const interval = setInterval(() => {
      fetchTravelers(0, true);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const fetchTravelers = async (retryCount = 0, isPoll = false) => {
    try {
      {
        const data = await fetchAllTravelerRows();
        const formattedTravelers = data.map((t: Record<string, unknown>) => ({
          id: String(t.job_number),
          dbId: Number(t.id),
          jobNumber: String(t.job_number),
          rmaNumber: String(t.rma_number || ''),
          jobDisplay: formatJobDisplay(String(t.traveler_type || ''), String(t.rma_number || ''), String(t.job_number)),
          workOrder: String(t.work_order_number || ''),
          poNumber: String(t.po_number || ''),
          invoiceNumber: String(t.invoice_number || ''),
          partNumber: String(t.part_number),
          description: String(t.part_description),
          revision: String(t.revision || ''),
          customerRevision: String(t.customer_revision || ''),
          quantity: Number(t.quantity),
          customerCode: String(t.customer_code || ''),
          customerName: String(t.customer_name || ''),
          travelerType: String(t.traveler_type || 'PCB_ASSEMBLY'),
          status: String(t.status),
          currentStep: 'PENDING',
          progress: Number(t.percent_complete || 0),
          totalSteps: Number(t.total_steps || 0),
          completedSteps: Number(t.completed_steps || 0),
          departmentProgress: (Array.isArray(t.department_progress) ? t.department_progress as DeptProgress[] : [])
            .slice()
            .sort((a, b) => departmentRank(a.department) - departmentRank(b.department)),
          laborProgress: (t.labor_progress as LaborProgress) || { total_hours: 0, entries_count: 0, active_entries: 0, steps_with_labor: 0, total_steps: 0, percent: 0 },
          createdAt: String(t.created_at || ''),
          dueDate: String(t.due_date || ''),
          shipDate: String(t.ship_date || ''),
          specs: String(t.specs || ''),
          fromStock: String(t.from_stock || ''),
          toStock: String(t.to_stock || ''),
          shipVia: String(t.ship_via || ''),
          comments: String(t.comments || ''),
          isActive: Boolean(t.is_active !== false),
          includeLaborHours: Boolean(t.include_labor_hours)
        }));
        const json = JSON.stringify(formattedTravelers);
        const changed = lastTravelersJsonRef.current !== '' && lastTravelersJsonRef.current !== json;
        lastTravelersJsonRef.current = json;
        setTravelers(formattedTravelers);
        writeLiveCache(TRAVELERS_CACHE_KEY, formattedTravelers);
        setTravelersLoading(false);
        if (isPoll && changed) notifyDataUpdated();
      }
    } catch (error) {
      console.error('Error fetching travelers:', error);
      if (retryCount < 1) {
        setTimeout(() => fetchTravelers(retryCount + 1, isPoll), 1000);
      } else {
        setTravelersLoading(false);
      }
    }
  };

  const getStatusBadge = (status: string, progress?: number) => {
    // Determine display label based on status and progress
    let label = status.replace('_', ' ');
    let configKey = status;

    if ((status === 'IN_PROGRESS' || status === 'CREATED') && typeof progress === 'number' && progress > 0) {
      if (progress >= 90) {
        label = 'Final Inspection';
        configKey = 'FINAL_INSPECTION';
      } else if (progress >= 70) {
        label = 'Testing & QC';
        configKey = 'TESTING';
      } else if (progress >= 40) {
        label = 'In Manufacturing';
        configKey = 'IN_MANUFACTURING';
      } else if (progress >= 10) {
        label = 'Production Started';
        configKey = 'PRODUCTION_STARTED';
      } else {
        label = 'Prep & Kitting';
        configKey = 'PREP';
      }
    } else if (status === 'CREATED') {
      label = 'Awaiting Start';
    } else if (status === 'COMPLETED') {
      label = 'Completed';
    }

    const statusConfig: Record<string, { color: string; bg: string; text: string }> = {
      'DRAFT': { color: 'border-amber-300 dark:border-amber-700 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/40 dark:to-yellow-900/40', bg: 'bg-amber-100', text: 'text-amber-800 dark:text-amber-300' },
      'CREATED': { color: 'border-blue-300 dark:border-blue-700 bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-900/40 dark:to-emerald-900/40', bg: 'bg-blue-100', text: 'text-blue-800 dark:text-blue-300' },
      'PREP': { color: 'border-cyan-300 dark:border-cyan-700 bg-gradient-to-r from-cyan-50 to-sky-50 dark:from-cyan-900/40 dark:to-sky-900/40', bg: 'bg-cyan-100', text: 'text-cyan-800 dark:text-cyan-300' },
      'PRODUCTION_STARTED': { color: 'border-indigo-300 dark:border-indigo-700 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/40 dark:to-blue-900/40', bg: 'bg-indigo-100', text: 'text-indigo-800 dark:text-indigo-300' },
      'IN_MANUFACTURING': { color: 'border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/40 dark:to-pink-900/40', bg: 'bg-purple-100', text: 'text-purple-800 dark:text-purple-300' },
      'TESTING': { color: 'border-violet-300 dark:border-violet-700 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/40', bg: 'bg-violet-100', text: 'text-violet-800 dark:text-violet-300' },
      'FINAL_INSPECTION': { color: 'border-teal-300 dark:border-teal-700 bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-900/40 dark:to-emerald-900/40', bg: 'bg-teal-100', text: 'text-teal-800 dark:text-teal-300' },
      'IN_PROGRESS': { color: 'border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/40 dark:to-pink-900/40', bg: 'bg-purple-100', text: 'text-purple-800 dark:text-purple-300' },
      'COMPLETED': { color: 'border-green-300 dark:border-green-700 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/40 dark:to-emerald-900/40', bg: 'bg-green-100', text: 'text-green-800 dark:text-green-300' },
      'ON_HOLD': { color: 'border-orange-300 dark:border-orange-700 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/40 dark:to-red-900/40', bg: 'bg-orange-100', text: 'text-orange-800 dark:text-orange-300' },
      'CANCELLED': { color: 'border-red-300 dark:border-red-700 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-900/40 dark:to-rose-900/40', bg: 'bg-red-100', text: 'text-red-800 dark:text-red-300' },
      'ARCHIVED': { color: 'border-gray-300 dark:border-slate-600 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-slate-700 dark:to-slate-700', bg: 'bg-gray-100', text: 'text-gray-800 dark:text-slate-300' }
    };

    const config = statusConfig[configKey] || statusConfig['CREATED'];
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold border ${config.color} ${config.text} whitespace-nowrap`}>
        {label}
      </span>
    );
  };

  const filteredTravelers = travelers.filter(t => {
    const matchesSearch = t.jobNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (t.rmaNumber && t.rmaNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          t.jobDisplay.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.customerCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.customerName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'All Statuses' || t.status === statusFilter;

    const matchesType = typeFilter === 'all' || t.travelerType === typeFilter ||
      (typeFilter === 'PCB_ASSEMBLY' && (t.travelerType === 'PCB_ASSEMBLY' || t.travelerType === 'ASSY')) ||
      (typeFilter === 'CABLE' && (t.travelerType === 'CABLE' || t.travelerType === 'CABLES')) ||
      (typeFilter === 'RMA' && (t.travelerType === 'RMA_SAME' || t.travelerType === 'RMA_DIFF' || t.travelerType === 'MODIFICATION'));

    const matchesView =
      (viewFilter === 'active' && t.status !== 'DRAFT') ||
      (viewFilter === 'drafts' && t.status === 'DRAFT') ||
      (viewFilter === 'all');

    return matchesSearch && matchesStatus && matchesType && matchesView;
  });

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, typeFilter, viewFilter, sortField, sortDirection]);

  // Sort filtered travelers
  const sortedTravelers = [...filteredTravelers].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    const av = a[sortField];
    const bv = b[sortField];

    // Handle empty/undefined — push empties to the end regardless of direction
    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    if (sortField === 'createdAt' || sortField === 'dueDate' || sortField === 'shipDate') {
      const at = new Date(av as string).getTime();
      const bt = new Date(bv as string).getTime();
      const aValid = !isNaN(at);
      const bValid = !isNaN(bt);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return (at - bt) * dir;
    }

    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }

    // jobNumber: try numeric compare first, fall back to locale string compare
    if (sortField === 'jobNumber') {
      const an = parseFloat(String(av));
      const bn = parseFloat(String(bv));
      if (!isNaN(an) && !isNaN(bn) && String(an) === String(av).trim() && String(bn) === String(bv).trim()) {
        return (an - bn) * dir;
      }
    }

    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });

  // Pagination calculations
  const totalPages = Math.ceil(sortedTravelers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTravelers = sortedTravelers.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const toggleSelectTraveler = (dbId: number) => {
    if (selectedTravelers.includes(dbId)) {
      setSelectedTravelers(selectedTravelers.filter(id => id !== dbId));
    } else {
      setSelectedTravelers([...selectedTravelers, dbId]);
    }
  };

  const selectAll = () => {
    const currentPageIds = paginatedTravelers.map(t => t.dbId);
    const allCurrentPageSelected = currentPageIds.every(id => selectedTravelers.includes(id));

    if (allCurrentPageSelected) {
      // Deselect all on current page
      setSelectedTravelers(selectedTravelers.filter(id => !currentPageIds.includes(id)));
    } else {
      // Select all on current page
      const newSelected = [...selectedTravelers];
      currentPageIds.forEach(id => {
        if (!newSelected.includes(id)) {
          newSelected.push(id);
        }
      });
      setSelectedTravelers(newSelected);
    }
  };

  const doDeleteSelected = async () => {
    try {
      const token = localStorage.getItem('nexus_token');
      await Promise.all(
        selectedTravelers.map(id =>
          fetch(`${API_BASE_URL}/travelers/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          })
        )
      );

      showToast(`Archived ${selectedTravelers.length} traveler(s) — find them under Archived`, 'success');
      setSelectedTravelers([]);
      fetchTravelers();
    } catch (error) {
      console.error('Error deleting travelers:', error);
      showToast('Failed to archive travelers', 'error');
    }
    closeConfirm();
  };

  const deleteSelected = () => {
    if (selectedTravelers.length === 0) {
      showToast('Please select travelers to archive', 'error');
      return;
    }
    showConfirm('Archive Travelers', `Archive ${selectedTravelers.length} traveler(s)?\n\nNothing is deleted — they keep all their steps, labor and history, and you can restore them from Travelers -> Archived.`, doDeleteSelected, 'Archive');
  };

  const exportSelectedPDFs = async () => {
    if (selectedTravelers.length === 0) {
      showToast('Please select travelers to export', 'error');
      return;
    }

    showToast(`Exporting ${selectedTravelers.length} traveler(s) as PDFs...`, 'info');

    // Open each traveler in a new window for printing
    selectedTravelers.forEach((dbId, index) => {
      setTimeout(() => {
        window.open(`/travelers/${dbId}?print=true`, `_blank`);
      }, index * 500); // Stagger to avoid browser blocking
    });
  };

  const stats = {
    total: travelers.length,
    active: travelers.filter(t => t.status !== 'DRAFT').length,
    drafts: travelers.filter(t => t.status === 'DRAFT').length
  };

  return (
    <Layout fullWidth>
      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirm}
      />

      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-2 sm:p-4 lg:p-6">
        {/* Header with Stats */}
        <div className="mb-3 sm:mb-4 bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 text-white rounded-xl p-3 sm:p-4 shadow-xl relative overflow-hidden">
          <div className="relative z-10 flex flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="bg-white/15 backdrop-blur-sm p-2 rounded-lg border border-white/20">
                <svg className="w-5 h-5 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">Travelers Management</h1>
                <p className="text-xs text-teal-200/80">Manage production travelers and track progress</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/20 text-center">
                <div className="text-lg font-extrabold">{stats.active}</div>
                <div className="text-[11px] text-blue-200/70 uppercase tracking-wider font-semibold">Active</div>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/20 text-center">
                <div className="text-lg font-extrabold">{stats.drafts}</div>
                <div className="text-[11px] text-blue-200/70 uppercase tracking-wider font-semibold">Drafts</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters and Actions */}
        <div className="mb-3 sm:mb-4 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 p-2 sm:p-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
            {/* Search */}
            <div className="flex-1 min-w-0 sm:min-w-[200px]">
              <input
                type="text"
                placeholder="Search job#, part#, description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500"
              />
            </div>

            {/* View Filter Tabs */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5 overflow-x-auto">
              {(['active', 'drafts', 'all'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setViewFilter(view)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all whitespace-nowrap ${
                    viewFilter === view
                      ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm'
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {view.charAt(0).toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>

            {/* Type Filter Tabs */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5 overflow-x-auto">
              {([
                { value: 'all', label: 'All Types', color: 'from-gray-600 to-gray-700' },
                { value: 'PCB_ASSEMBLY', label: 'PCBA', color: 'from-blue-600 to-blue-700' },
                { value: 'PCB', label: 'PCB', color: 'from-green-600 to-green-700' },
                { value: 'CABLE', label: 'Cable', color: 'from-purple-600 to-purple-700' },
                { value: 'PURCHASING', label: 'Purch', color: 'from-orange-600 to-orange-700' },
                { value: 'RMA', label: 'RMA', color: 'from-red-600 to-red-700' }
              ]).map((type) => (
                <button
                  key={type.value}
                  onClick={() => setTypeFilter(type.value)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-all whitespace-nowrap ${
                    typeFilter === type.value
                      ? `bg-gradient-to-r ${type.color} text-white shadow-sm`
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>

            {/* Saved Filters */}
            <div className="relative flex items-center gap-1">
              {savedFilters.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto">
                  {savedFilters.map((f) => (
                    <div key={f.name} className="flex items-center gap-0.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg pl-2 pr-1 py-0.5 group">
                      <button
                        onClick={() => loadFilter(f)}
                        className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 whitespace-nowrap hover:text-indigo-900 dark:hover:text-indigo-100"
                      >
                        {f.name}
                      </button>
                      <button
                        onClick={() => deleteFilter(f.name)}
                        className="text-indigo-300 hover:text-red-500 dark:text-indigo-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <XCircleIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {showSaveFilter ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newFilterName}
                    onChange={(e) => setNewFilterName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveCurrentFilter()}
                    placeholder="Filter name..."
                    className="w-24 px-2 py-1 border border-indigo-300 dark:border-indigo-600 rounded text-xs bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                    autoFocus
                  />
                  <button onClick={saveCurrentFilter} className="px-1.5 py-1 bg-indigo-600 text-white rounded text-xs font-semibold">Save</button>
                  <button onClick={() => setShowSaveFilter(false)} className="px-1.5 py-1 bg-gray-300 dark:bg-slate-600 text-gray-700 dark:text-slate-300 rounded text-xs">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveFilter(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors whitespace-nowrap"
                  title="Save current filters as a preset"
                >
                  <FunnelIcon className="h-3.5 w-3.5" />
                  <span>Save Filter</span>
                </button>
              )}
            </div>

            {/* Create Button - Admin only */}
            {user?.role !== 'OPERATOR' && (
              <Link
                href="/travelers/new"
                className="flex items-center space-x-1 px-3 py-1.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-bold shadow-sm transition-all text-xs"
              >
                <PlusIcon className="h-4 w-4" />
                <span>New Traveler</span>
              </Link>
            )}
          </div>

          {/* Action Buttons - Admin only */}
          {user?.role !== 'OPERATOR' && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
              <button
                onClick={selectAll}
                className="flex items-center space-x-1 px-2.5 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-semibold"
              >
                <CheckIcon className="h-3.5 w-3.5" />
                <span>{selectedTravelers.length === filteredTravelers.length ? 'Deselect All' : 'Select All'}</span>
              </button>

              <button
                onClick={exportSelectedPDFs}
                disabled={selectedTravelers.length === 0}
                className="flex items-center space-x-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-slate-600 text-white rounded text-xs font-semibold disabled:cursor-not-allowed"
              >
                <DocumentArrowDownIcon className="h-3.5 w-3.5" />
                <span>Export ({selectedTravelers.length})</span>
              </button>

              <button
                onClick={deleteSelected}
                disabled={selectedTravelers.length === 0}
                className="flex items-center space-x-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-slate-600 text-white rounded text-xs font-semibold disabled:cursor-not-allowed"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                <span>Archive ({selectedTravelers.length})</span>
              </button>
            </div>
          )}
        </div>

        {/* Travelers Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
          {/* Table Header + Pagination */}
          <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 rounded-t-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
            </div>
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-white">Travelers List</h2>
                <span className="text-xs font-semibold text-white bg-white/20 px-2 py-0.5 rounded-full">
                  {filteredTravelers.length}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor="travelers-sort" className="text-xs font-semibold text-white/90 whitespace-nowrap">Sort by:</label>
                <select
                  id="travelers-sort"
                  value={`${sortField}:${sortDirection}`}
                  onChange={(e) => {
                    const [f, d] = e.target.value.split(':') as [SortField, SortDirection];
                    setSortField(f);
                    setSortDirection(d);
                  }}
                  className="text-xs font-semibold bg-white/95 dark:bg-slate-700 text-gray-900 dark:text-slate-100 border border-white/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
                >
                  <option value="createdAt:desc">Latest first</option>
                  <option value="createdAt:asc">Oldest first</option>
                  <option value="jobNumber:asc">Job # (A → Z)</option>
                  <option value="jobNumber:desc">Job # (Z → A)</option>
                  <option value="dueDate:asc">Due Date (soonest)</option>
                  <option value="dueDate:desc">Due Date (latest)</option>
                  <option value="shipDate:asc">Ship Date (soonest)</option>
                  <option value="shipDate:desc">Ship Date (latest)</option>
                  <option value="status:asc">Status (A → Z)</option>
                  <option value="customerCode:asc">Customer (A → Z)</option>
                  <option value="customerCode:desc">Customer (Z → A)</option>
                  <option value="partNumber:asc">Part # (A → Z)</option>
                  <option value="partNumber:desc">Part # (Z → A)</option>
                  <option value="quantity:desc">Quantity (high → low)</option>
                  <option value="quantity:asc">Quantity (low → high)</option>
                  <option value="progress:desc">Progress (high → low)</option>
                  <option value="progress:asc">Progress (low → high)</option>
                </select>
              </div>
            </div>
          </div>
          {travelersLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-slate-400">Loading travelers...</p>
            </div>
          ) : filteredTravelers.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
                <DocumentArrowDownIcon className="h-8 w-8 text-gray-400 dark:text-slate-500" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-slate-200 mb-2">No Travelers Found</h3>
              <p className="text-gray-600 dark:text-slate-400">Try adjusting your search or filters</p>
            </div>
          ) : (
            <>

            {/* Desktop Table View — hidden, replaced by card grid below */}
            <div className="hidden w-full relative overflow-x-auto">
              <div className="absolute top-0 left-0 right-0 h-14 overflow-hidden pointer-events-none z-20">
                <div className="absolute top-0 right-8 w-20 h-20 bg-white/10 rounded-full -translate-y-1/2" />
                <div className="absolute top-2 left-12 w-12 h-12 bg-white/10 rounded-full" />
                <div className="absolute top-0 right-1/3 w-8 h-8 bg-white/5 rounded-full translate-y-1" />
              </div>
              <table className="w-full divide-y divide-gray-200 dark:divide-slate-700" style={{tableLayout: 'auto'}}>
                <colgroup>
                  <col style={{width: '36px'}} />
                  <col style={{width: '14%'}} />
                  <col style={{width: '17%'}} />
                  <col style={{width: '12%'}} />
                  <col style={{width: '10%'}} />
                  <col style={{width: '10%'}} />
                  <col style={{width: '8%'}} />
                  <col style={{width: '10%'}} />
                  <col style={{width: '12%'}} />
                  <col style={{width: '7%'}} />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800">
                    <th className="px-0.5 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{width: '30px'}}>
                      <input
                        type="checkbox"
                        checked={paginatedTravelers.length > 0 && paginatedTravelers.every(t => selectedTravelers.includes(t.dbId))}
                        onChange={selectAll}
                        className="h-4 w-4 text-blue-600 rounded cursor-pointer"
                      />
                    </th>
                    <th className="px-1 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{width: '70px'}}>Actions</th>
                    <th className="px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('jobNumber')}
                        className="inline-flex items-center gap-1 hover:text-yellow-200 transition-colors"
                        title="Sort by Job Number"
                      >
                        <span>Job, WO &amp; PO</span>
                        {sortField === 'jobNumber' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('partNumber')}
                        className="inline-flex items-center gap-1 hover:text-yellow-200 transition-colors"
                        title="Sort by Part Number"
                      >
                        <span>Part Details</span>
                        {sortField === 'partNumber' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('customerCode')}
                        className="inline-flex items-center gap-1 hover:text-yellow-200 transition-colors"
                        title="Sort by Customer"
                      >
                        <span>Customer</span>
                        {sortField === 'customerCode' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort(sortField === 'dueDate' ? 'createdAt' : sortField === 'createdAt' ? 'dueDate' : 'createdAt')}
                        className="inline-flex items-center gap-1 hover:text-yellow-200 transition-colors"
                        title="Click to cycle: Created → Due"
                      >
                        <span>Dates</span>
                        {(sortField === 'createdAt' || sortField === 'dueDate') ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('shipDate')}
                        className="inline-flex items-center gap-1 hover:text-yellow-200 transition-colors"
                        title="Sort by Ship Date"
                      >
                        <span>Shipping</span>
                        {sortField === 'shipDate' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-1 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('status')}
                        className="inline-flex items-center gap-1 mx-auto hover:text-yellow-200 transition-colors"
                        title="Sort by Status"
                      >
                        <span>Status</span>
                        {sortField === 'status' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-1 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white">
                      <button
                        type="button"
                        onClick={() => toggleSort('progress')}
                        className="inline-flex items-center gap-1 mx-auto hover:text-yellow-200 transition-colors"
                        title="Sort by Progress"
                      >
                        <span>Steps</span>
                        {sortField === 'progress' ? (
                          sortDirection === 'asc' ? <ChevronUpIcon className="h-4 w-4 text-yellow-300" /> : <ChevronDownIcon className="h-4 w-4 text-yellow-300" />
                        ) : <ChevronUpDownIcon className="h-4 w-4 text-yellow-300" />}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{minWidth: '220px', width: '25%'}}>
                      Depts
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                  {paginatedTravelers.map((traveler) => (
                    <tr
                      key={traveler.dbId}
                      className={`transition-colors ${
                        selectedTravelers.includes(traveler.dbId)
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <td className="px-0.5 py-2 text-center" style={{width: '30px'}}>
                        <input
                          type="checkbox"
                          checked={selectedTravelers.includes(traveler.dbId)}
                          onChange={() => toggleSelectTraveler(traveler.dbId)}
                          className="h-4 w-4 text-blue-600 rounded cursor-pointer"
                        />
                      </td>
                      {/* Actions — 2x2 grid */}
                      <td className="px-1 py-1" style={{width: '70px'}}>
                        <div className={`grid ${user?.role !== 'OPERATOR' ? 'grid-cols-2' : 'grid-cols-1'} gap-0.5 w-fit mx-auto`}>
                          <Link href={`/travelers/${traveler.dbId}`} className="p-0.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors flex items-center justify-center" title="View">
                            <EyeIcon className="h-4 w-4" />
                          </Link>
                          {user?.role !== 'OPERATOR' && (
                            <>
                              <Link href={`/travelers/${traveler.dbId}?edit=true`} className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors flex items-center justify-center" title="Edit">
                                <PencilIcon className="h-4 w-4" />
                              </Link>
                              <button
                                onClick={() => {
                                  showConfirm('Archive Traveler', `Archive traveler ${traveler.jobNumber}?\n\nNothing is deleted — it keeps all its steps, labor and history, and you can restore it from Travelers -> Archived.`,
                                    async () => {
                                      try {
                                        const token = localStorage.getItem('nexus_token');
                                        const response = await fetch(`${API_BASE_URL}/travelers/${traveler.dbId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                                        if (response.ok) { showToast(`Traveler ${traveler.jobNumber} archived`, 'success'); fetchTravelers(); }
                                        else { showToast('Failed to archive traveler', 'error'); }
                                      } catch (error) { console.error('Error:', error); showToast('Failed to archive traveler', 'error'); }
                                      closeConfirm();
                                    }, 'Delete');
                                }}
                                className="p-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors flex items-center justify-center" title="Archive"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => window.open(`/travelers/${traveler.dbId}?print=true`, '_blank')} className="p-0.5 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 rounded transition-colors flex items-center justify-center" title="Print">
                                <PrinterIcon className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="space-y-0.5 overflow-hidden">
                          <div className="mb-0.5 flex items-center gap-1 flex-wrap">
                            {getTravelerTypeBadge(traveler.travelerType)}
                            {traveler.status === 'DRAFT' && (
                              <span className="inline-flex items-center px-1.5 py-0 rounded-full text-xs font-bold border border-amber-400 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 animate-pulse">
                                DRAFT
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-bold text-gray-900 dark:text-slate-100 truncate">{traveler.jobDisplay !== traveler.jobNumber ? <span className="underline">{traveler.jobDisplay}</span> : <>Job# <span className="underline">{traveler.jobDisplay}</span></>}</div>
                          <div className="text-xs font-extrabold text-indigo-700 dark:text-indigo-400 truncate">WO# <span className="underline">{traveler.workOrder || 'N/A'}</span></div>
                          <div className="text-xs font-semibold text-purple-700 dark:text-purple-400 truncate">PO# <span className="underline">{traveler.poNumber || 'N/A'}</span></div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="space-y-0.5 overflow-hidden">
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate">Part# <span className="underline">{traveler.partNumber}</span></div>
                          <div className="text-xs text-gray-600 dark:text-slate-400 truncate" title={traveler.description}>Desc: {traveler.description || 'N/A'}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400 space-y-0">
                            <div>BOM Rev: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.revision || 'N/A'}</span> · Cust Rev: <span className="font-semibold text-blue-700 dark:text-blue-400">{traveler.customerRevision || 'N/A'}</span></div>
                            <div>Qty: <span className="font-bold text-gray-900 dark:text-slate-100">{traveler.quantity}</span></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="space-y-0.5 overflow-hidden">
                          <div className="text-xs text-gray-600 dark:text-slate-400 truncate">Code: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.customerCode || 'N/A'}</span></div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="space-y-0.5">
                          <div className="text-xs text-gray-600 dark:text-slate-400">Start: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.createdAt ? formatDateDisplay(traveler.createdAt.split('T')[0]) : 'N/A'}</span></div>
                          <div className="text-xs text-gray-600 dark:text-slate-400">Due: <span className="font-semibold text-gray-900 dark:text-slate-100 underline">{traveler.dueDate ? formatDateDisplay(traveler.dueDate) : 'N/A'}</span></div>
                          <div className="text-xs text-gray-600 dark:text-slate-400">Ship: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.shipDate ? formatDateDisplay(traveler.shipDate) : 'N/A'}</span></div>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="space-y-0.5 overflow-hidden">
                          <div className="text-xs text-gray-600 dark:text-slate-400 truncate">Via: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.shipVia || 'N/A'}</span></div>
                          <div className="text-xs text-gray-600 dark:text-slate-400 truncate">From: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.fromStock || 'N/A'}</span></div>
                          <div className="text-xs text-gray-600 dark:text-slate-400 truncate">To: <span className="font-semibold text-gray-900 dark:text-slate-100">{traveler.toStock || 'N/A'}</span></div>
                        </div>
                      </td>
                      {/* Status Column */}
                      <td className="px-1 py-2 text-center">
                        {getStatusBadge(traveler.status, traveler.progress)}
                      </td>
                      {/* Step Progress Column */}
                      <td className="px-1 py-2">
                        <Link href={`/travelers/${traveler.dbId}`} className="block hover:opacity-80 transition-opacity cursor-pointer">
                          <div className="flex flex-col items-center gap-1">
                            <div className="relative w-11 h-11 flex-shrink-0">
                              <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                                <circle cx="22" cy="22" r="19" fill="none" stroke="#e5e7eb" strokeWidth="2.5" className="dark:stroke-slate-600" />
                                <circle cx="22" cy="22" r="19" fill="none"
                                  stroke={traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : traveler.progress >= 25 ? '#f97316' : '#ef4444'}
                                  strokeWidth="2.5" strokeLinecap="round"
                                  strokeDasharray={`${traveler.progress * 1.194} 119.4`}
                                />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold text-gray-700 dark:text-slate-300">{traveler.completedSteps}/{traveler.totalSteps}</span>
                            </div>
                            <span className="text-[11px] font-bold" style={{ color: traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : traveler.progress >= 25 ? '#f97316' : '#ef4444' }}>{traveler.progress}%</span>
                            <div className="w-full min-w-0">
                              <div className="w-full bg-gray-100 dark:bg-slate-600 rounded-full h-1.5 overflow-hidden">
                                <div className="h-1.5 rounded-full transition-all duration-500"
                                  style={{ width: `${traveler.progress}%`, backgroundColor: traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : '#f97316' }}
                                />
                              </div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      {/* Department Progress Column */}
                      <td className="px-2 py-2" style={{minWidth: '220px', width: '25%'}}>
                        <Link href={`/travelers/${traveler.dbId}`} className="block hover:opacity-80 transition-opacity cursor-pointer">
                          {traveler.departmentProgress.length > 0 ? (
                            <div className="space-y-0.5">
                              {traveler.departmentProgress.map((dept) => {
                                const isComplete = dept.percent_complete >= 100;
                                const isNotStarted = dept.completed_steps === 0;
                                return (
                                  <div key={dept.department} className="flex items-center gap-1">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isComplete ? 'bg-green-500' : isNotStarted ? 'bg-gray-300 dark:bg-slate-600' : 'bg-blue-500 animate-pulse'}`} />
                                    <span className="text-xs font-semibold w-16 truncate" style={{ color: DEPARTMENT_BAR_COLORS[dept.department] || '#6b7280' }} title={dept.department}>{dept.department}</span>
                                    <div className="flex-1 bg-gray-100 dark:bg-slate-600 rounded-full h-2 overflow-hidden">
                                      <div className="h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${dept.percent_complete}%`, backgroundColor: isComplete ? '#16a34a' : (DEPARTMENT_BAR_COLORS[dept.department] || '#6b7280') }}
                                      />
                                    </div>
                                    <span className="text-xs font-bold text-gray-500 dark:text-slate-400 w-7 text-right">{dept.percent_complete}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-[11px] text-gray-400 dark:text-slate-500 text-center">—</div>
                          )}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Card View - shown on all screen sizes (responsive grid) */}
            <div className="block w-full">
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {paginatedTravelers.map((traveler) => (
                  <div key={traveler.dbId} className={`border-2 rounded-lg shadow-sm transition-colors ${
                    selectedTravelers.includes(traveler.dbId)
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500'
                      : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                  }`}>
                    {/* Card Header */}
                    <div className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white px-3 py-2 rounded-t-lg flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={selectedTravelers.includes(traveler.dbId)}
                          onChange={() => toggleSelectTraveler(traveler.dbId)}
                          className="h-5 w-5 text-blue-600 rounded cursor-pointer"
                        />
                        <div>
                          <div className="text-sm font-bold">{traveler.jobDisplay !== traveler.jobNumber ? traveler.jobDisplay : `Job# ${traveler.jobDisplay}`}</div>
                          <div className="text-xs text-blue-100">WO# {traveler.workOrder || 'N/A'}</div>
                          <div className="text-xs text-blue-100">PO# {traveler.poNumber || 'N/A'}</div>
                          <div className="text-xs text-blue-100">Invoice# {traveler.invoiceNumber || 'N/A'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {getTravelerTypeBadge(traveler.travelerType)}
                        {traveler.status === 'DRAFT' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border border-amber-400 bg-amber-100 text-amber-800 animate-pulse">
                            DRAFT
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-3 space-y-2">
                      {/* Status & Progress Row */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          {getStatusBadge(traveler.status, traveler.progress)}
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <div className="relative w-11 h-11 flex-shrink-0">
                            <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                              <circle cx="22" cy="22" r="19" fill="none" stroke="#e5e7eb" strokeWidth="2.5" className="dark:stroke-slate-600" />
                              <circle cx="22" cy="22" r="19" fill="none"
                                stroke={traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : traveler.progress >= 25 ? '#f97316' : '#ef4444'}
                                strokeWidth="2.5" strokeLinecap="round"
                                strokeDasharray={`${traveler.progress * 1.194} 119.4`}
                              />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold text-gray-700 dark:text-slate-300">{traveler.completedSteps}/{traveler.totalSteps}</span>
                          </div>
                          <span className="text-[11px] font-bold" style={{ color: traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : traveler.progress >= 25 ? '#f97316' : '#ef4444' }}>{traveler.progress}%</span>
                          <div className="w-16 bg-gray-100 dark:bg-slate-600 rounded-full h-1.5 overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${traveler.progress}%`, backgroundColor: traveler.progress >= 100 ? '#16a34a' : traveler.progress >= 75 ? '#2563eb' : traveler.progress >= 50 ? '#f59e0b' : '#f97316' }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Part Details */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Part Number</div>
                          <div className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{traveler.partNumber}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Quantity</div>
                          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{traveler.quantity}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Description</div>
                        <div className="text-xs text-gray-700 dark:text-slate-300 truncate">{traveler.description || 'N/A'}</div>
                      </div>

                      {/* Revisions */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">BOM Rev</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100">{traveler.revision || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Cust Rev</div>
                          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">{traveler.customerRevision || 'N/A'}</div>
                        </div>
                      </div>

                      {/* Customer */}
                      <div className="grid grid-cols-1 gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Cust Code</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate">{traveler.customerCode || 'N/A'}</div>
                        </div>
                      </div>

                      {/* Dates */}
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Start</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100">{traveler.createdAt ? formatDateDisplay(traveler.createdAt.split('T')[0]) : 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Due</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 underline">{traveler.dueDate ? formatDateDisplay(traveler.dueDate) : 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Ship</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100">{traveler.shipDate ? formatDateDisplay(traveler.shipDate) : 'N/A'}</div>
                        </div>
                      </div>

                      {/* Shipping */}
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">Via</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate" title={traveler.shipVia}>{traveler.shipVia || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">From</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate" title={traveler.fromStock}>{traveler.fromStock || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase">To</div>
                          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate" title={traveler.toStock}>{traveler.toStock || 'N/A'}</div>
                        </div>
                      </div>

                      {/* Department Progress */}
                      {traveler.departmentProgress.length > 0 && (
                        <div className="pt-2 border-t border-gray-200 dark:border-slate-700 space-y-1">
                          {traveler.departmentProgress.map((dept) => {
                            const isComplete = dept.percent_complete >= 100;
                            const isNotStarted = dept.completed_steps === 0;
                            return (
                              <div key={dept.department} className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isComplete ? 'bg-green-500' : isNotStarted ? 'bg-gray-300 dark:bg-slate-600' : 'bg-blue-500 animate-pulse'}`} />
                                <span className="text-[11px] font-semibold w-14 truncate" style={{ color: DEPARTMENT_BAR_COLORS[dept.department] || '#6b7280' }}>{dept.department}</span>
                                <div className="flex-1 bg-gray-100 dark:bg-slate-600 rounded-full h-1.5 overflow-hidden">
                                  <div className="h-1.5 rounded-full transition-all duration-500"
                                    style={{ width: `${dept.percent_complete}%`, backgroundColor: isComplete ? '#16a34a' : (DEPARTMENT_BAR_COLORS[dept.department] || '#6b7280') }}
                                  />
                                </div>
                                <span className="text-[11px] font-bold text-gray-500 dark:text-slate-400 w-8 text-right">{dept.percent_complete}%</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="pt-2 border-t border-gray-200 dark:border-slate-700">
                        <div className={`grid ${user?.role !== 'OPERATOR' ? 'grid-cols-4' : 'grid-cols-1'} gap-1`}>
                          <Link
                            href={`/travelers/${traveler.dbId}`}
                            className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors flex flex-col items-center justify-center"
                            title="View"
                          >
                            <EyeIcon className="h-5 w-5" />
                            <span className="text-[10px] mt-0.5">View</span>
                          </Link>
                          {user?.role !== 'OPERATOR' && (
                            <>
                              <Link
                                href={`/travelers/${traveler.dbId}?edit=true`}
                                className="p-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors flex flex-col items-center justify-center"
                                title="Edit"
                              >
                                <PencilIcon className="h-5 w-5" />
                                <span className="text-[10px] mt-0.5">Edit</span>
                              </Link>
                              <button
                                onClick={() => window.open(`/travelers/${traveler.dbId}?print=true`, '_blank')}
                                className="p-2 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors flex flex-col items-center justify-center"
                                title="Print"
                              >
                                <PrinterIcon className="h-5 w-5" />
                                <span className="text-[10px] mt-0.5">Print</span>
                              </button>
                              <button
                                onClick={() => {
                                  showConfirm(
                                    'Archive Traveler',
                                    `Archive traveler ${traveler.jobNumber}?\n\nNothing is deleted — it keeps all its steps, labor and history, and you can restore it from Travelers -> Archived.`,
                                    async () => {
                                      try {
                                        const token = localStorage.getItem('nexus_token');
                                        const response = await fetch(`${API_BASE_URL}/travelers/${traveler.dbId}`, {
                                          method: 'DELETE',
                                          headers: { 'Authorization': `Bearer ${token}` }
                                        });
                                        if (response.ok) {
                                          showToast(`Traveler ${traveler.jobNumber} archived`, 'success');
                                          fetchTravelers();
                                        } else {
                                          showToast('Failed to archive traveler', 'error');
                                        }
                                      } catch (error) {
                                        console.error('Error:', error);
                                        showToast('Failed to archive traveler', 'error');
                                      }
                                      closeConfirm();
                                    },
                                    'Delete'
                                  );
                                }}
                                className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors flex flex-col items-center justify-center"
                                title="Archive"
                              >
                                <TrashIcon className="h-5 w-5" />
                                <span className="text-[10px] mt-0.5">Archive</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

              {/* Bottom Pagination Controls */}
              {filteredTravelers.length > 0 && (
                <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 relative overflow-hidden rounded-b-xl">
                  <div className="absolute inset-0 opacity-10 pointer-events-none">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="absolute bottom-0 left-0 w-12 h-12 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
                  </div>
                  <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="pagination-select">
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={1000}>All</option>
                      </select>
                      <span className="text-xs text-white/80">{startIndex + 1}-{Math.min(endIndex, filteredTravelers.length)} of {filteredTravelers.length}</span>
                    </div>
                    <div className="flex items-center gap-0.5 flex-wrap justify-center">
                      <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2 py-1 rounded text-xs font-semibold bg-white/20 border border-white/30 text-white hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed">«</button>
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2 py-1 rounded text-xs font-semibold bg-white/20 border border-white/30 text-white hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed">‹</button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let page: number;
                        if (totalPages <= 5) page = i + 1;
                        else if (currentPage <= 3) page = i + 1;
                        else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                        else page = currentPage - 2 + i;
                        return (
                          <button key={page} onClick={() => setCurrentPage(page)} className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${currentPage === page ? 'bg-white text-indigo-700 shadow-sm' : 'bg-white/20 border border-white/30 text-white hover:bg-white/30'}`}>{page}</button>
                        );
                      })}
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="px-2 py-1 rounded text-xs font-semibold bg-white/20 border border-white/30 text-white hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed">›</button>
                      <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalPages === 0} className="px-2 py-1 rounded text-xs font-semibold bg-white/20 border border-white/30 text-white hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed">»</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
