'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '@/components/layout/Layout';
import Modal from '@/components/Modal';
import { ClockIcon, UserIcon, DocumentTextIcon, PlayIcon, StopIcon, PencilIcon, TrashIcon, EyeIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';
import { prefersTableView } from '@/lib/viewPrefs';
import { formatHoursDualCompact, formatHoursDual, formatSecondsCompact } from '@/utils/timeHelpers';
import Autocomplete, { AutocompleteHandle } from '@/components/ui/Autocomplete';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import { offlineFetch } from '@/lib/offlineSync';
import { readLiveCache, writeLiveCache, notifyDataUpdated, LIVE_REFRESH_MS } from '@/lib/liveCache';

const LABOR_CACHE_KEY = 'nexus_labor_entries_v1';

interface LaborEntry {
  id: number;
  traveler_id: number;
  step_id?: number;
  employee_id: number;
  employee_name: string;
  start_time: string;
  pause_time?: string;
  end_time?: string;
  hours_worked: number;
  description: string;
  is_completed: boolean;
  created_at: string;
  // Additional fields for display
  job_number?: string;
  // Combined "<rma> RMA JOB NO <job>" label for RMA travelers (else plain job number)
  job_display?: string;
  work_order?: string;
  work_center?: string;
  sequence_number?: number;
  qty_completed?: number;
  comment?: string;
  pause_logs?: PauseLogItem[];
  total_pause_seconds?: number;
  pause_count?: number;
}

interface PauseLogItem {
  id: number;
  paused_at: string;
  resumed_at?: string;
  duration_seconds?: number;
  comment?: string;
}

type LaborSortField = 'date' | 'job' | 'work_order' | 'operator' | 'work_center' | 'start' | 'end' | 'hours' | 'qty';
type LaborSortDirection = 'asc' | 'desc';

function SortableTh({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
  align = 'left',
}: {
  field: LaborSortField;
  label: string;
  sortField: LaborSortField;
  sortDirection: LaborSortDirection;
  onSort: (field: LaborSortField) => void;
  align?: 'left' | 'center';
}) {
  const isActive = sortField === field;
  const justify = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-4 py-3 text-${align} text-xs font-extrabold text-white uppercase tracking-wider cursor-pointer select-none hover:bg-white/10 transition-colors`}
      title={`Sort by ${label}`}
    >
      <span className={`inline-flex items-center gap-1 ${justify} w-full`}>
        <span>{label}</span>
        <span className="flex flex-col leading-none text-[9px]">
          <span className={isActive && sortDirection === 'asc' ? 'text-white' : 'text-white/40'}>▲</span>
          <span className={isActive && sortDirection === 'desc' ? 'text-white' : 'text-white/40'}>▼</span>
        </span>
      </span>
    </th>
  );
}

export default function LaborTrackingPage() {
  const { user } = useAuth();
  // Card grid for everyone, dense table for the users listed in viewPrefs.
  // Both renderings below read the same filtered/paginated entries.
  const useTableView = prefersTableView(user?.username);
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>(() => readLiveCache<LaborEntry[]>(LABOR_CACHE_KEY) ?? []);
  const lastLaborJsonRef = useRef<string>('');
  const [selectedEntries, setSelectedEntries] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(() => (readLiveCache<LaborEntry[]>(LABOR_CACHE_KEY) ?? []).length === 0);
  const [filter, setFilter] = useState({
    jobNumber: '',
    workCenter: '',
    operatorName: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
  });
  const [newEntry, setNewEntry] = useState({
    job_number: '',
    job_display: '',
    work_center: '',
    step_id: undefined as number | undefined,
    operator_name: '',
    operator_id: undefined as number | undefined,
    date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
  });
  const [jobWorkCenterOptions, setJobWorkCenterOptions] = useState<Array<{step_id: number; step_number: number; operation: string; work_center_code: string; label: string; value: string}>>([]);
  const [workCenterConfirmed, setWorkCenterConfirmed] = useState(false);
  // Refs used to pull focus between fields after a scan so operators don't
  // forget to enter the job number before starting the timer.
  const jobNumberAutocompleteRef = useRef<AutocompleteHandle | null>(null);
  const workCenterAutocompleteRef = useRef<AutocompleteHandle | null>(null);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [pauseTime, setPauseTime] = useState<Date | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null);
  const [showPauseCommentModal, setShowPauseCommentModal] = useState(false);
  const [pauseComment, setPauseComment] = useState('');
  const [pauseAction, setPauseAction] = useState<'pause' | 'resume'>('pause');
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LaborEntry | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<LaborEntry | null>(null);

  // Manual entry and edit modals (ADMIN only)
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [manualEntryData, setManualEntryData] = useState({
    job_number: '',
    // Combined RMA label shown in the field; job_number stays the lookup key.
    job_display: '',
    // Pins the work-center lookup to one traveler when several share a job_number.
    traveler_id: undefined as number | undefined,
    work_center: '',
    step_id: undefined as number | undefined,
    operator_name: '',
    operator_id: undefined as number | undefined,
    start_time: '',
    end_time: '',
    comment: '',
    qty_completed: '' as string,
    pauses: [] as Array<{ paused_at: string; resumed_at: string; comment: string }>,
  });
  const [manualJobWorkCenterOptions, setManualJobWorkCenterOptions] = useState<Array<{step_id: number; step_number: number; operation: string; work_center_code: string; label: string; value: string}>>([]);
  const [editEntryData, setEditEntryData] = useState({
    id: 0,
    job_number: '',
    work_center: '',
    operator_name: '',
    start_time: '',
    end_time: '',
    comment: '',
    qty_completed: '' as string,
    pause_logs: [] as PauseLogItem[],
    newPause: { paused_at: '', resumed_at: '', comment: '' },
  });

  // Qty completed modal states
  const [isQtyModalOpen, setIsQtyModalOpen] = useState(false);
  const [qtyCompleted, setQtyCompleted] = useState('');
  const [stopComment, setStopComment] = useState('');
  const [pendingStopEntryId, setPendingStopEntryId] = useState<number | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [travelerMaxQty, setTravelerMaxQty] = useState<number | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Drag reorder state (admin only)
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [manualOrder, setManualOrder] = useState(false);

  // Sorting state
  const [sortField, setSortField] = useState<LaborSortField>('date');
  const [sortDirection, setSortDirection] = useState<LaborSortDirection>('desc');
  const handleSort = (field: LaborSortField) => {
    setManualOrder(false);
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Job Summary states
  const [jobListExpanded, setJobListExpanded] = useState(false);
  const [summaryJobSearch, setSummaryJobSearch] = useState('');
  const [selectedJobChip, setSelectedJobChip] = useState<string | null>(null);

  // The traveler_id returned by /labor/scan when a WC QR is scanned. We
  // persist this so startTimer can target the exact traveler the operator
  // scanned — otherwise two travelers sharing a job_number (e.g. breakouts)
  // get confused and labor lands on the wrong WO. Cleared whenever the job
  // number or work center is edited manually so stale scan data can't leak.
  const scannedTravelerIdRef = useRef<number | null>(null);
  // The WO that the scanned QR resolved to. Shown in the form so the operator
  // can visually confirm the scan picked the correct breakout before hitting
  // Start. Cleared alongside scannedTravelerIdRef.
  const [scannedWorkOrder, setScannedWorkOrder] = useState<string | null>(null);

  // Track the running timer's work center/step for auto-stop on re-scan
  const lastStartedWorkCenterRef = useRef<string>('');
  const lastStartedWorkCenterCodeRef = useRef<string>('');
  // Active traveler id for the currently-running labor entry. Used by the
  // kitting timer mirror calls below — those endpoints take a traveler_id.
  const lastStartedTravelerIdRef = useRef<number | null>(null);
  // Accumulated pause seconds for the current entry — used by the timer
  // effect to subtract pause time from the displayed elapsed time so it
  // matches actual worked time (not wall-clock time).
  const totalPauseSecondsRef = useRef<number>(0);
  const lastStartedStepIdRef = useRef<number | undefined>(undefined);

  // Global scanner listener — auto-stop when timer is running
  // Detects rapid keystrokes (scanner) ending with Enter, calls /labor/scan to verify match, stops timer
  const globalScanBufferRef = useRef('');
  const globalScanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isTimerRunning) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Some scanners emit a Tab suffix instead of Enter. Treat both as the
      // terminator so scanner config doesn't have to match one specific setting.
      const isScanTerminator = (e.key === 'Enter' || e.key === 'Tab') && globalScanBufferRef.current.length > 1;
      if (isScanTerminator) {
        const scannedValue = globalScanBufferRef.current.trim();
        globalScanBufferRef.current = '';
        if (globalScanTimeoutRef.current) clearTimeout(globalScanTimeoutRef.current);

        if (scannedValue.startsWith('NEXUS-STEP|')) {
          // Always preventDefault on Tab so the buffered scan doesn't move focus
          // to the next control before we process it.
          if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
          }
          try {
            const token = localStorage.getItem('nexus_token');
            const scanResp = await fetch(
              `${API_BASE_URL}/labor/scan?qr_data=${encodeURIComponent(scannedValue)}`,
              { headers: { 'Authorization': `Bearer ${token || 'mock-token'}` } }
            );
            if (scanResp.ok) {
              const scanData = await scanResp.json();
              // Match by step_id (most precise), work_center_code, or operation name
              const shouldStop =
                (scanData.step_id && scanData.step_id === lastStartedStepIdRef.current) ||
                (scanData.work_center_code && scanData.work_center_code === lastStartedWorkCenterCodeRef.current) ||
                (scanData.operation && scanData.operation.toLowerCase() === lastStartedWorkCenterRef.current.toLowerCase());

              if (shouldStop) {
                e.preventDefault();
                e.stopPropagation();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                stopTimer();
              }
            }
          } catch (err) {
            console.error('Global scan lookup failed:', err);
          }
        }
        return;
      }

      // Buffer printable characters with 100ms gap detection (scanner speed)
      if (e.key.length === 1) {
        if (globalScanTimeoutRef.current) clearTimeout(globalScanTimeoutRef.current);
        globalScanBufferRef.current += e.key;
        globalScanTimeoutRef.current = setTimeout(() => {
          globalScanBufferRef.current = '';
        }, 100);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (globalScanTimeoutRef.current) clearTimeout(globalScanTimeoutRef.current);
      globalScanBufferRef.current = '';
    };
  }, [isTimerRunning]);

  // Auto-fill operator name from signed-in user
  useEffect(() => {
    if (user && !isTimerRunning) {
      const fullName = `${user.first_name || user.username}`.trim();
      setNewEntry(prev => ({ ...prev, operator_name: fullName, operator_id: user.id }));
    }
  }, [user]);

  // Combined init fetch — single API call for active entry + entries + auto-stop
  const fetchLaborInit = async (silent = false) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const res = await fetch(`${API_BASE_URL}/labor/init`, {
        headers: { 'Authorization': `Bearer ${token || 'mock-token'}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Set entries
        const validEntries = (data.entries || []).filter((entry: LaborEntry) => entry.hours_worked >= 0);
        const json = JSON.stringify(validEntries);
        const changed = lastLaborJsonRef.current !== '' && lastLaborJsonRef.current !== json;
        lastLaborJsonRef.current = json;
        setLaborEntries(validEntries);
        writeLiveCache(LABOR_CACHE_KEY, validEntries);
        if (silent && changed) notifyDataUpdated();
        // Set active entry — restore full timer state so the circular
        // display and pause/resume buttons work correctly on page load.
        if (data.active_entry) {
          setIsTimerRunning(true);
          setActiveEntryId(data.active_entry.id);
          lastStartedWorkCenterRef.current = data.active_entry.work_center || '';
          lastStartedTravelerIdRef.current = data.active_entry.traveler_id || null;
          const start = new Date(data.active_entry.start_time);
          setStartTime(start);
          totalPauseSecondsRef.current = data.active_entry.total_pause_seconds ? Math.floor(data.active_entry.total_pause_seconds) : 0;
          if (data.active_entry.pause_time) {
            const paused = new Date(data.active_entry.pause_time);
            setIsPaused(true);
            setPauseTime(paused);
            const wallSecs = Math.floor((paused.getTime() - start.getTime()) / 1000);
            setElapsedTime(Math.max(wallSecs - totalPauseSecondsRef.current, 0));
          } else {
            const wallSecs = Math.floor((Date.now() - start.getTime()) / 1000);
            setElapsedTime(Math.max(wallSecs - totalPauseSecondsRef.current, 0));
          }
          setNewEntry(prev => ({
            ...prev,
            job_number: data.active_entry.job_number || '',
            job_display: data.active_entry.job_display || data.active_entry.job_number || '',
            work_center: data.active_entry.work_center || '',
          }));
        }
      }
    } catch (e) {
      console.error('Error fetching labor init:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLaborInit();

    // Live auto-refresh (silent) so other users' changes surface within ~30s.
    const pollInterval = setInterval(() => {
      fetchLaborInit(true);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(pollInterval);
  }, []);

  // Auto-resolve QR scan data in work center field
  // Scanner types NEXUS-STEP|...|AC (may add trailing chars like } or newline)
  const qrResolveRef = useRef<NodeJS.Timeout | null>(null);
  const qrResolvingRef = useRef(false);

  const resolveQrCode = useCallback(async (rawValue: string) => {
    if (qrResolvingRef.current) return;
    qrResolvingRef.current = true;
    try {
      // Extract the NEXUS-STEP|...|AC part, strip any trailing junk
      const match = rawValue.match(/(NEXUS-STEP\|[^}{\n\r]+\|AC)/);
      if (!match) { qrResolvingRef.current = false; return; }
      const qrString = match[1];

      const token = localStorage.getItem('nexus_token');
      const scanResp = await fetch(
        `${API_BASE_URL}/labor/scan?qr_data=${encodeURIComponent(qrString)}`,
        { headers: { 'Authorization': `Bearer ${token || 'mock-token'}` } }
      );
      if (scanResp.ok) {
        const scanData = await scanResp.json();
        if (typeof scanData.traveler_id === 'number') {
          scannedTravelerIdRef.current = scanData.traveler_id;
        }
        setScannedWorkOrder(scanData.work_order || null);
        setNewEntry(prev => ({
          ...prev,
          job_number: scanData.job_number || prev.job_number,
          job_display: scanData.job_display || scanData.job_number || prev.job_display,
          work_center: scanData.operation,
          step_id: scanData.step_id,
        }));
        setWorkCenterConfirmed(true);
        if (scanData.job_number) {
          // Pin to the scanned traveler (set just above): an RMA and the job it
          // reworks share a job_number, so an unpinned lookup returns the wrong
          // traveler's steps (e.g. SHIPPING as step 19 instead of the RMA's 9).
          const steps = await fetchWorkCentersByJob(scanData.job_number, '', scannedTravelerIdRef.current);
          setJobWorkCenterOptions(steps);
        }
        // Intentionally NOT warning on already-completed steps. Operators
        // legitimately re-scan completed steps (logging additional time,
        // touch-ups, returning to a step). The toast is noise that's been
        // confusing operators on the floor — let the start/stop flow speak
        // for itself.
      }
    } catch (err) {
      console.error('QR resolve failed:', err);
    } finally {
      qrResolvingRef.current = false;
    }
  }, [isTimerRunning]);

  useEffect(() => {
    if (qrResolveRef.current) clearTimeout(qrResolveRef.current);
    const wc = newEntry.work_center;
    if (isTimerRunning || !wc.includes('NEXUS-STEP|')) return;
    // Check the string has enough parts (at least 10 pipe-separated segments)
    const pipeCount = (wc.match(/\|/g) || []).length;
    if (pipeCount < 9) return; // Still typing, not complete yet

    qrResolveRef.current = setTimeout(() => resolveQrCode(wc), 50);
    return () => { if (qrResolveRef.current) clearTimeout(qrResolveRef.current); };
  }, [newEntry.work_center, isTimerRunning, resolveQrCode]);

  // Mirror of backend utils/job_display.extract_job_number: pull the real job
  // number out of a combined RMA label so lookups still resolve. The field now
  // carries the whole label ("1107 RMA JOB NO 8825L"); the API wants "8825L".
  const extractJobNumber = (labelOrJob: string): string => {
    const marker = ' RMA JOB NO ';
    const s = labelOrJob || '';
    return s.includes(marker) ? s.split(marker)[1].trim() : s.trim();
  };

  // Autocomplete fetch functions
  const fetchJobNumbers = async (query: string) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const url = query
        ? `${API_BASE_URL}/search/autocomplete/job-numbers?q=${encodeURIComponent(query)}&limit=20`
        : `${API_BASE_URL}/search/autocomplete/job-numbers?limit=20`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // value is the UNIQUE combined label, not the bare job number: an RMA
        // traveler and the job it reworks share a job_number, so a bare-number
        // value made the options ambiguous and exact-match/scan always resolved
        // to the first (non-RMA) traveler.
        return data.map((item: any) => ({
          value: item.job_display || item.job_number,
          label: item.label,
          description: item.customer_name,
          ...item
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching job numbers:', error);
      return [];
    }
  };

  const fetchWorkCenters = async (query: string) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const url = query
        ? `${API_BASE_URL}/search/autocomplete/work-centers?q=${encodeURIComponent(query)}&limit=10`
        : `${API_BASE_URL}/search/autocomplete/work-centers?limit=10`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        return data.map((item: any) => ({
          value: item.value,
          label: item.label,
          description: item.description,
          ...item
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching work centers:', error);
      return [];
    }
  };

  const fetchOperators = async (query: string) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const url = query
        ? `${API_BASE_URL}/search/autocomplete/operators?q=${encodeURIComponent(query)}&limit=50`
        : `${API_BASE_URL}/search/autocomplete/operators?limit=50`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        return data.map((item: any) => ({
          value: item.value,
          label: item.label,
          description: item.role,
          ...item
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching operators:', error);
      return [];
    }
  };

  // Fetch work centers from process steps for a specific job number.
  // travelerId pins the lookup to a specific WO breakout when the same
  // job_number has multiple travelers (the dropdown supplies it).
  const fetchWorkCentersByJob = async (jobNumber: string, query: string = '', travelerId?: number | null, jobDisplay?: string | null) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const travelerParam = travelerId != null ? `&traveler_id=${encodeURIComponent(travelerId)}` : '';
      // Fallback disambiguator when no traveler is pinned (typed / scanner Enter):
      // the combined RMA label identifies the traveler the bare job_number can't.
      const displayParam = !travelerId && jobDisplay ? `&job_display=${encodeURIComponent(jobDisplay)}` : '';
      const url = `${API_BASE_URL}/search/autocomplete/work-centers-by-job?job_number=${encodeURIComponent(jobNumber)}&q=${encodeURIComponent(query)}${travelerParam}${displayParam}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token || 'mock-token'}` }
      });
      if (response.ok) {
        const data = await response.json();
        return data.map((item: any) => ({
          value: item.value,
          label: item.label,
          description: `Step ${item.step_number}`,
          ...item
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching work centers by job:', error);
      return [];
    }
  };

  // When job number text changes (typing), just update the value - don't fetch steps yet
  const handleJobNumberChange = (value: string) => {
    // Any manual edit of the job number invalidates a previously-scanned
    // traveler_id — the operator may now mean a different traveler entirely.
    scannedTravelerIdRef.current = null;
    setScannedWorkOrder(null);
    // The field carries the display label (possibly a full RMA label, typed or
    // scanned); job_number stays the real lookup key.
    setNewEntry(prev => ({ ...prev, job_number: extractJobNumber(value), job_display: value }));
    if (!value) {
      setJobWorkCenterOptions([]);
    }
  };

  // Handle job number selection from autocomplete dropdown - THIS is when we fetch steps
  const handleJobNumberSelect = async (option: any) => {
    // option.value is now the combined label; extract the real job number when
    // the option is synthesized from typed/scanned text (no job_number field).
    const jobNum = (option.job_number || extractJobNumber(option.value || '')).trim();
    if (!jobNum) return;
    // The dropdown now returns one row per traveler (job_number + WO). If the
    // picked option carries a traveler_id, pin it so the start-timer flow
    // lands on the correct WO breakout instead of erroring out with the
    // "Job has N open travelers" guard. Falls back to the prior behavior
    // (no pin) for legacy options that don't include an id.
    const pickedTravelerId =
      typeof option.traveler_id === 'number' ? option.traveler_id :
      typeof option.id === 'number' ? option.id : null;
    scannedTravelerIdRef.current = pickedTravelerId;
    setScannedWorkOrder(option.work_order_number || null);
    setNewEntry(prev => ({ ...prev, job_number: jobNum, job_display: option.job_display || option.value || jobNum, work_center: '', step_id: undefined }));
    const steps = await fetchWorkCentersByJob(jobNum, '', pickedTravelerId);
    setJobWorkCenterOptions(steps);
    // After the job is scanned/selected, pull focus to the Work Center field
    // so the operator's next scan lands on the correct input.
    requestAnimationFrame(() => workCenterAutocompleteRef.current?.focus());
  };

  // Check and auto-stop entries at 5pm
  const checkAutoStop5pm = async () => {
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/labor/check-auto-stop`, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.completed_count > 0) {
          toast.warning(`Auto-stopped ${data.completed_count} entries at 5pm cutoff`);
        }
      }
    } catch (error) {
      console.error('Error checking auto-stop:', error);
    }
  };

  // Timer effect — when paused, elapsedTime is frozen at whatever value
  // was set by the pause handler. When running, it ticks from startTime
  // but subtracts accumulated pause duration so the display doesn't jump.
  useEffect(() => {
    if (isTimerRunning && startTime && !isPaused) {
      timerIntervalRef.current = setInterval(() => {
        const now = new Date();
        let diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
        // Subtract total pause seconds so displayed time matches actual worked time
        if (totalPauseSecondsRef.current > 0) {
          diff = Math.max(diff - totalPauseSecondsRef.current, 0);
        }
        setElapsedTime(diff);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      // When paused, do NOT reset elapsedTime — it stays frozen at the
      // value captured by the pause handler.
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isTimerRunning, startTime, isPaused]);


  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Filter labor entries
  const filteredEntries = laborEntries.filter(entry => {
    const workCenter = entry.work_center || entry.description?.split(' - ')?.[0] || '';
    const operatorName = entry.employee_name || entry.description?.split(' - ')?.[1] || '';

    // Filter by job number. A picked chip is an EXACT identity match on the
    // chip's own label: an RMA traveler's label contains the job number it
    // reworks ("1107 RMA JOB NO 8825L" contains "8825L"), so a substring test
    // made the plain 8825L chip sweep in the RMA's hours too — the opposite of
    // keeping RMA rework time separate. Free-text still matches loosely across
    // the label and the raw number.
    if (selectedJobChip) {
      const chipLabel = entry.job_display || entry.job_number || `Traveler #${entry.traveler_id}`;
      if (chipLabel !== selectedJobChip) return false;
    } else if (filter.jobNumber) {
      const needle = filter.jobNumber.toLowerCase();
      const haystack = `${entry.job_display || ''} ${entry.job_number || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    // Filter by work center
    if (filter.workCenter && !workCenter.toLowerCase().includes(filter.workCenter.toLowerCase())) {
      return false;
    }

    // Filter by operator name
    if (filter.operatorName && !operatorName.toLowerCase().includes(filter.operatorName.toLowerCase())) {
      return false;
    }

    // Filter by date range
    if (filter.startDate) {
      const entryDate = new Date(entry.start_time).toISOString().split('T')[0];
      if (entryDate < filter.startDate) {
        return false;
      }
    }

    if (filter.endDate) {
      const entryDate = new Date(entry.start_time).toISOString().split('T')[0];
      if (entryDate > filter.endDate) {
        return false;
      }
    }

    return true;
  });

  // Sort: respects user-selected sort field/direction — skip if admin manually reordered
  const getSortValue = (entry: LaborEntry, field: LaborSortField): string | number => {
    switch (field) {
      case 'date':
      case 'start':
        return new Date(entry.start_time).getTime() || 0;
      case 'end':
        return entry.end_time ? new Date(entry.end_time).getTime() : 0;
      case 'job':
        return (entry.job_number || '').toLowerCase();
      case 'work_order':
        return (entry.work_order || '').toLowerCase();
      case 'operator':
        return (entry.employee_name || entry.description?.split(' - ')?.[1] || '').toLowerCase();
      case 'work_center':
        return (entry.work_center || entry.description?.split(' - ')?.[0] || '').toLowerCase();
      case 'hours':
        return entry.hours_worked || 0;
      case 'qty':
        return entry.qty_completed || 0;
      default:
        return 0;
    }
  };
  const sortedEntries = manualOrder ? filteredEntries : [...filteredEntries].sort((a, b) => {
    const va = getSortValue(a, sortField);
    const vb = getSortValue(b, sortField);
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  // Pagination calculations
  const totalPages = Math.ceil(sortedEntries.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedEntries = sortedEntries.slice(startIndex, startIndex + itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter.jobNumber, filter.workCenter, filter.operatorName, filter.startDate, filter.endDate]);

  const checkActiveEntry = async () => {
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/labor/active`, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data) {
          setActiveEntryId(data.id);
          const start = new Date(data.start_time);
          setStartTime(start);
          setIsTimerRunning(true);

          // Restore accumulated pause seconds from prior pauses
          totalPauseSecondsRef.current = data.total_pause_seconds ? Math.floor(data.total_pause_seconds) : 0;

          // Restore paused state if the entry was paused
          if (data.pause_time) {
            const paused = new Date(data.pause_time);
            setIsPaused(true);
            setPauseTime(paused);
            // Freeze elapsed time at worked time (wall-clock minus all pauses)
            const wallSecs = Math.floor((paused.getTime() - start.getTime()) / 1000);
            const worked = Math.max(wallSecs - totalPauseSecondsRef.current, 0);
            setElapsedTime(worked);
          }

          // Store traveler max qty for validation
          if (data.quantity) setTravelerMaxQty(data.quantity);

          // Extract job number and work center from description
          const parts = data.description.split(' - ');
          if (parts.length >= 2) {
            const workCenterName = parts[0] || '';
            setWorkCenterConfirmed(true);
            setNewEntry({
              job_number: data.job_number || '',
              job_display: data.job_display || data.job_number || '',
              work_center: workCenterName,
              step_id: data.step_id || undefined,
              operator_name: parts[1] || '',
              operator_id: data.employee_id || user?.id,
              date: start.toISOString().slice(0, 10),
            });
            // Set refs for QR auto-stop matching
            lastStartedWorkCenterRef.current = workCenterName;
            lastStartedWorkCenterCodeRef.current = data.work_center_code || workCenterName;
            lastStartedStepIdRef.current = data.step_id || undefined;
          }
        }
      }
    } catch (error) {
      console.error('Error checking active entry:', error);
    }
  };

  const fetchLaborEntries = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/labor/my-entries`, {
        headers: {
          'Authorization': `Bearer ${token || 'mock-token'}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Backend now returns job_number and work_center directly - no need for N+1 calls
        const validEntries = data.filter((entry: LaborEntry) => entry.hours_worked >= 0);
        setLaborEntries(validEntries);
      } else {
        console.error('Failed to fetch labor entries');
      }
    } catch (error) {
      console.error('Error fetching labor entries:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startTimer = async () => {
    // Trim before validating — whitespace-only scans were slipping past the
    // truthy check and producing entries with no job number attached.
    const jobNumber = (newEntry.job_number || '').trim();
    const workCenter = (newEntry.work_center || '').trim();
    const operatorName = (newEntry.operator_name || '').trim();

    if (!jobNumber) {
      toast.error('Job Number is required — scan or select a job before starting the timer');
      jobNumberAutocompleteRef.current?.select();
      return;
    }
    if (!workCenter) {
      toast.error('Work Center is required — scan or select a work center before starting the timer');
      workCenterAutocompleteRef.current?.select();
      return;
    }
    if (!operatorName) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (!workCenterConfirmed) {
      toast.error('Please select a work center from the dropdown');
      workCenterAutocompleteRef.current?.select();
      return;
    }

    // Sync trimmed values back into state so the request body is clean.
    if (jobNumber !== newEntry.job_number || workCenter !== newEntry.work_center) {
      setNewEntry(prev => ({ ...prev, job_number: jobNumber, work_center: workCenter }));
    }

    try {
      const token = localStorage.getItem('nexus_token');

      // First, find the traveler by job number. We query the by-job-number
      // endpoint directly instead of GET /travelers/ — the latter is paginated
      // to 50 newest rows, so older travelers (e.g. 5477 KANBAN) silently
      // dropped out of the lookup and the operator saw "Job number not found"
      // even though the traveler existed.
      const travelersResponse = await fetch(
        `${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(jobNumber)}/all-work-orders`,
        {
          headers: {
            'Authorization': `Bearer ${token || 'mock-token'}`
          }
        }
      );

      if (!travelersResponse.ok) {
        toast.error('Failed to fetch travelers');
        return;
      }

      const matchesByJob = await travelersResponse.json();

      // If a WC QR was scanned, the scan response pinned the exact traveler.
      // Prefer that over a job_number lookup — multiple travelers can share a
      // job_number (different WO breakouts) and picking the first by job
      // alone silently logs labor against the wrong work order.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let traveler: any = null;
      const scannedId = scannedTravelerIdRef.current;
      if (scannedId != null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        traveler = matchesByJob.find((t: any) => t.id === scannedId) ?? null;
        // The scanned traveler may belong to a different job_number than the
        // one typed in the form (e.g. operator scanned a WC QR then changed
        // the job field). Fall back to a direct fetch by id so the start
        // still resolves rather than failing with "Job number not found".
        if (!traveler) {
          try {
            const byIdResp = await fetch(`${API_BASE_URL}/travelers/${scannedId}`, {
              headers: { 'Authorization': `Bearer ${token || 'mock-token'}` }
            });
            if (byIdResp.ok) {
              traveler = await byIdResp.json();
            }
          } catch {
            // ignore — fall through to the not-found toast below
          }
        }
      } else if (matchesByJob.length === 1) {
        traveler = matchesByJob[0];
      } else if (matchesByJob.length > 1) {
        // Ambiguous manual entry — don't guess. Force the operator to scan the
        // WC QR (which pins traveler_id) so labor lands on the correct WO.
        toast.error(
          `Job ${jobNumber} has ${matchesByJob.length} open travelers (different WOs). ` +
          `Scan the Work Center QR on the correct traveler to continue.`
        );
        workCenterAutocompleteRef.current?.select();
        return;
      }

      if (!traveler) {
        toast.error(`Job number ${jobNumber} not found`);
        jobNumberAutocompleteRef.current?.select();
        return;
      }

      const description = `${workCenter} - ${operatorName}`;
      // Use current system time when Start button is clicked
      const now = new Date();

      const requestBody: any = {
        traveler_id: traveler.id,
        start_time: now.toISOString(),
        description: description
      };

      // Pass step_id if selected from work center dropdown
      if (newEntry.step_id) {
        requestBody.step_id = newEntry.step_id;
      }

      // Admin can assign entry to another user
      if (user?.role === 'ADMIN' && newEntry.operator_id && newEntry.operator_id !== user.id) {
        requestBody.employee_id = newEntry.operator_id;
      }

      const response = await offlineFetch(`${API_BASE_URL}/labor/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify(requestBody),
        offlineType: 'labor_start'
      });

      const data = await response.json();
      if (data.offline && data.queued) {
        setStartTime(now);
        setElapsedTime(0);
        totalPauseSecondsRef.current = 0;
        setIsTimerRunning(true);
        toast.info('Offline: Timer saved locally. Will sync when back online.');
      } else if (response.ok) {
        setActiveEntryId(data.id);
        setStartTime(now);
        setElapsedTime(0);
        totalPauseSecondsRef.current = 0;
        setIsTimerRunning(true);
        setTravelerMaxQty(traveler.quantity || null);
        // Scan is now consumed by an active timer; reset so a later manual
        // start doesn't accidentally inherit this traveler_id.
        scannedTravelerIdRef.current = null;
        setScannedWorkOrder(null);
        lastStartedWorkCenterRef.current = newEntry.work_center; // display name e.g. "FEEDER LOAD"
        lastStartedTravelerIdRef.current = traveler.id;
        // Find the matching work center code from job steps for QR auto-stop matching
        const matchingStep = jobWorkCenterOptions.find((s: any) =>
          s.value === newEntry.work_center || s.operation === newEntry.work_center || s.step_id === newEntry.step_id
        );
        lastStartedWorkCenterCodeRef.current = matchingStep?.work_center_code || matchingStep?.value || newEntry.work_center;
        lastStartedStepIdRef.current = newEntry.step_id;
        // Mirror to dedicated kitting timer subsystem (silent / fire-and-forget)
        // so we get the rich session log without interfering with labor tracking.
        mirrorKittingTimer('start', traveler.id, newEntry.work_center);
        toast.success('Timer started!');
        fetchLaborEntries();
      } else {
        toast.error(`Error: ${data.detail || 'Failed to start timer'}`);
      }
    } catch (error) {
      console.error('Error starting timer:', error);
      toast.error('Error starting timer');
    }
  };

  // ─── Kitting Timer mirror (silent, fire-and-forget) ─────────────────────
  // Whenever the active labor entry is on a kitting work center, mirror the
  // operator's start/pause-waiting/resume/stop to the dedicated /kitting/timer
  // subsystem. Errors are swallowed so a kitting-side hiccup never blocks the
  // labor entry. The kitting subsystem captures rich session + event data
  // for analytics — operators don't need to do anything different.
  const mirrorKittingTimer = (
    action: 'start' | 'pause-waiting' | 'resume' | 'stop',
    travelerId: number | null,
    workCenter: string
  ) => {
    if (!travelerId) return;
    if (!(workCenter || '').toUpperCase().includes('KIT')) return;
    try {
      const token = localStorage.getItem('nexus_token');
      fetch(`${API_BASE_URL}/kitting/timer/${travelerId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`,
        },
        body: JSON.stringify({}),
      }).catch(() => {
        // Silent — kitting mirror is best-effort, never blocks labor flow.
      });
    } catch {
      // Silent
    }
  };

  const pauseTimer = () => {
    if (!activeEntryId) {
      toast.error('No active timer found');
      return;
    }
    setPauseAction('pause');
    setPauseComment('');
    setShowPauseCommentModal(true);
  };

  // Pause specifically for "waiting on parts" — kitting jobs only.
  // Tagged with reason=WAITING_PARTS so it shows up in the kitting analytics
  // waiting metrics. Skips the comment modal for speed.
  const pauseWaitingParts = async () => {
    if (!activeEntryId) {
      toast.error('No active timer found');
      return;
    }
    try {
      const token = localStorage.getItem('nexus_token');
      const currentPauseTime = new Date();
      const response = await offlineFetch(`${API_BASE_URL}/labor/${activeEntryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify({
          pause_time: currentPauseTime.toISOString(),
          pause_comment: 'Waiting on parts',
          pause_reason: 'WAITING_PARTS',
        }),
        offlineType: 'labor_pause'
      });
      const data = await response.json();
      if (data.offline && data.queued) {
        if (startTime) {
          const worked = Math.floor((currentPauseTime.getTime() - startTime.getTime()) / 1000) - totalPauseSecondsRef.current;
          setElapsedTime(Math.max(worked, 0));
        }
        setIsPaused(true);
        setPauseTime(currentPauseTime);
        toast.info('Offline: Waiting-parts pause saved locally.');
      } else if (response.ok) {
        if (startTime) {
          const worked = Math.floor((currentPauseTime.getTime() - startTime.getTime()) / 1000) - totalPauseSecondsRef.current;
          setElapsedTime(Math.max(worked, 0));
        }
        setIsPaused(true);
        setPauseTime(currentPauseTime);
        // Mirror to kitting subsystem
        mirrorKittingTimer('pause-waiting', lastStartedTravelerIdRef.current, lastStartedWorkCenterRef.current);
        toast.info('Paused — waiting on parts');
        fetchLaborEntries();
      } else {
        toast.error(`Error: ${data.detail || 'Failed to set waiting state'}`);
      }
    } catch (error) {
      console.error('Error pausing for waiting parts:', error);
      toast.error('Error setting waiting state');
    }
  };

  const executePause = async (comment?: string) => {
    if (!activeEntryId) return;
    try {
      const token = localStorage.getItem('nexus_token');
      const currentPauseTime = new Date();

      const response = await offlineFetch(`${API_BASE_URL}/labor/${activeEntryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify({
          pause_time: currentPauseTime.toISOString(),
          pause_comment: comment || null
        }),
        offlineType: 'labor_pause'
      });

      const data = await response.json();
      if (data.offline && data.queued) {
        // Freeze the displayed time at the moment of pause
        if (startTime) {
          const worked = Math.floor((currentPauseTime.getTime() - startTime.getTime()) / 1000) - totalPauseSecondsRef.current;
          setElapsedTime(Math.max(worked, 0));
        }
        setIsPaused(true);
        setPauseTime(currentPauseTime);
        toast.info('Offline: Pause saved locally.');
      } else if (response.ok) {
        // Freeze the displayed time at the moment of pause
        if (startTime) {
          const worked = Math.floor((currentPauseTime.getTime() - startTime.getTime()) / 1000) - totalPauseSecondsRef.current;
          setElapsedTime(Math.max(worked, 0));
        }
        setIsPaused(true);
        setPauseTime(currentPauseTime);
        toast.info('Timer paused!');
        fetchLaborEntries();
      } else {
        toast.error(`Error: ${data.detail || 'Failed to pause timer'}`);
      }
    } catch (error) {
      console.error('Error pausing timer:', error);
      toast.error('Error pausing timer');
    }
  };

  const resumeTimer = () => {
    if (!activeEntryId) {
      toast.error('No active timer found');
      return;
    }
    // Resume directly without comment modal
    executeResume();
  };

  const executeResume = async (comment?: string) => {
    if (!activeEntryId) return;
    try {
      const token = localStorage.getItem('nexus_token');
      const response = await offlineFetch(`${API_BASE_URL}/labor/${activeEntryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify({
          clear_pause: true,
          pause_comment: comment || null
        }),
        offlineType: 'labor_resume'
      });

      const data = await response.json();
      // When resuming, add the pause duration to the running total so the
      // timer effect can subtract it from wall-clock elapsed time.
      const addPauseDuration = () => {
        if (pauseTime) {
          const pauseSecs = Math.floor((Date.now() - pauseTime.getTime()) / 1000);
          totalPauseSecondsRef.current += Math.max(pauseSecs, 0);
        }
      };
      if (data.offline && data.queued) {
        addPauseDuration();
        setIsPaused(false);
        setPauseTime(null);
        toast.info('Offline: Resume saved locally.');
      } else if (response.ok) {
        addPauseDuration();
        setIsPaused(false);
        setPauseTime(null);
        // Mirror to kitting subsystem (only fires if WC is kitting)
        mirrorKittingTimer('resume', lastStartedTravelerIdRef.current, lastStartedWorkCenterRef.current);
        toast.info('Timer resumed!');
        fetchLaborEntries();
      } else {
        toast.error(`Error: ${data.detail || 'Failed to resume timer'}`);
      }
    } catch (error) {
      console.error('Error resuming timer:', error);
      toast.error('Error resuming timer');
    }
  };

  const stopTimer = () => {
    if (!activeEntryId) {
      toast.error('No active timer found');
      return;
    }
    // Show qty modal before stopping. Clear both qty and comment so the modal
    // never opens with stale input from a prior failed attempt — that was the
    // source of confusing "first click fails, second works" reports.
    setPendingStopEntryId(activeEntryId);
    setQtyCompleted('');
    setStopComment('');
    setIsQtyModalOpen(true);
  };

  const confirmStopTimer = async () => {
    if (!pendingStopEntryId) return;
    if (isStopping) return;

    const trimmedQty = qtyCompleted.trim();
    if (trimmedQty === '') {
      toast.error('Please enter a quantity (use 0 with a reason if no units were completed).');
      return;
    }
    if (!/^\d+$/.test(trimmedQty)) {
      toast.error('Quantity must be a whole number.');
      return;
    }
    const parsedQtyNum = parseInt(trimmedQty, 10);
    if (!Number.isFinite(parsedQtyNum) || parsedQtyNum < 0) {
      toast.error('Quantity must be zero or a positive whole number.');
      return;
    }
    if (parsedQtyNum === 0 && !stopComment.trim()) {
      toast.error('Please enter a reason explaining why quantity is 0.');
      return;
    }

    setIsStopping(true);
    try {
      const token = localStorage.getItem('nexus_token');
      const endTime = new Date();

      const response = await offlineFetch(`${API_BASE_URL}/labor/${pendingStopEntryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify({
          end_time: endTime.toISOString(),
          is_completed: true,
          qty_completed: parsedQtyNum,
          comment: stopComment || null
        }),
        offlineType: 'labor_stop'
      });

      const respData = await response.json().catch(() => ({}));

      const closeModalAndReset = () => {
        setIsQtyModalOpen(false);
        setPendingStopEntryId(null);
        setQtyCompleted('');
        setStopComment('');
      };

      if (respData.offline && respData.queued) {
        setIsTimerRunning(false);
        setIsPaused(false);
        setElapsedTime(0);
        setStartTime(null);
        setPauseTime(null);
        setActiveEntryId(null);
        closeModalAndReset();
        toast.info('Offline: Stop saved locally. Will sync when back online.');
      } else if (response.ok) {
        // Mirror to kitting subsystem (only fires if WC was kitting)
        mirrorKittingTimer('stop', lastStartedTravelerIdRef.current, lastStartedWorkCenterRef.current);
        setIsTimerRunning(false);
        setIsPaused(false);
        setElapsedTime(0);
        setStartTime(null);
        setPauseTime(null);
        setActiveEntryId(null);
        const fullName = user ? (`${user.first_name || user.username}`.trim()) : '';
        setNewEntry({
          job_number: '',
          job_display: '',
          work_center: '',
          step_id: undefined,
          operator_name: fullName,
          operator_id: user?.id,
          date: new Date().toISOString().slice(0, 10),
        });
        setJobWorkCenterOptions([]);
        lastStartedWorkCenterRef.current = '';
        lastStartedWorkCenterCodeRef.current = '';
        lastStartedTravelerIdRef.current = null;
        lastStartedStepIdRef.current = undefined;

        closeModalAndReset();
        toast.success('Timer stopped and entry saved!');
        fetchLaborEntries();
      } else if (response.status === 404) {
        // Entry was deleted or doesn't exist — reset timer state
        setIsTimerRunning(false);
        setIsPaused(false);
        setElapsedTime(0);
        setStartTime(null);
        setPauseTime(null);
        setActiveEntryId(null);
        const fullName = user ? (`${user.first_name || user.username}`.trim()) : '';
        setNewEntry({
          job_number: '',
          job_display: '',
          work_center: '',
          step_id: undefined,
          operator_name: fullName,
          operator_id: user?.id,
          date: new Date().toISOString().slice(0, 10),
        });
        setJobWorkCenterOptions([]);
        lastStartedWorkCenterRef.current = '';
        lastStartedWorkCenterCodeRef.current = '';
        lastStartedTravelerIdRef.current = null;
        lastStartedStepIdRef.current = undefined;

        closeModalAndReset();
        toast.warning('Timer entry no longer exists. Timer has been reset.');
        fetchLaborEntries();
      } else {
        // Non-success: keep modal open with user's input so they can fix and retry.
        toast.error(`Error: ${respData.detail || 'Failed to stop timer'}`);
      }
    } catch (error) {
      // Network/exception: keep modal open — user can retry without re-entering qty.
      console.error('Error stopping timer:', error);
      toast.error('Error stopping timer');
    } finally {
      setIsStopping(false);
    }
  };

  const handleDelete = async () => {
    if (!entryToDelete) return;

    try {
      const token = localStorage.getItem('nexus_token');
      const response = await fetch(`${API_BASE_URL}/labor/${entryToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        toast.success('Entry deleted successfully!');
        fetchLaborEntries();
        setIsDeleteModalOpen(false);
        setEntryToDelete(null);
      } else {
        const errorData = await response.json();
        toast.error(`Failed to delete entry: ${errorData.detail || 'Unknown error'}`);
        console.error('Delete failed:', errorData);
      }
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Network error while deleting entry');
    }
  };

  const completeLaborEntry = async (entryId: number) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const endTime = new Date().toISOString();

      const response = await fetch(`${API_BASE_URL}/labor/${entryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || 'mock-token'}`
        },
        body: JSON.stringify({
          end_time: endTime,
          is_completed: true
        })
      });

      if (response.ok) {
        toast.success('Labor entry completed!');
        fetchLaborEntries();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.detail || 'Failed to complete labor entry'}`);
      }
    } catch (error) {
      console.error('Error completing labor entry:', error);
      toast.error('Error completing labor entry');
    }
  };

  const applyFilters = () => {
    fetchLaborEntries();
  };

  const clearFilters = () => {
    setFilter({
      jobNumber: '',
      workCenter: '',
      operatorName: '',
      startDate: '',
      endDate: '',
      startTime: '',
      endTime: '',
    });
    fetchLaborEntries();
  };

  const getTotalHours = () => {
    const total = laborEntries.reduce((sum, entry) => sum + (entry.hours_worked || 0), 0);
    return formatHoursDual(total);
  };

  // Manual entry handler (ADMIN only)
  // This creates a COMPLETED historical entry and does NOT start a timer
  const handleManualEntry = async () => {
    if (!manualEntryData.job_number || !manualEntryData.work_center || !manualEntryData.operator_name || !manualEntryData.start_time || !manualEntryData.end_time) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Zero qty requires a written explanation for accountability.
    if (manualEntryData.qty_completed === '0' && !(manualEntryData.comment && manualEntryData.comment.trim())) {
      toast.error('Please enter a reason in the Comment field when quantity is 0.');
      return;
    }

    try {
      const token = localStorage.getItem('nexus_token');

      // Resolve the traveler via the by-job-number endpoint. GET /travelers/
      // is paginated to the 50 newest rows, so older jobs silently fell out of
      // the lookup and manual entry failed with "Job number not found" even
      // though the traveler existed. The timer path already uses this endpoint
      // for exactly this reason.
      const travelersResponse = await fetch(
        `${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(manualEntryData.job_number)}/all-work-orders`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!travelersResponse.ok) {
        toast.error('Failed to fetch travelers');
        return;
      }

      const matchesByJob = await travelersResponse.json();

      // A job_number can have multiple WO breakouts. The selected Work Center
      // pins the exact traveler (its step_id belongs to one traveler), so use
      // it to disambiguate; with a single WO, just take it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let traveler: any = null;
      if (matchesByJob.length === 1) {
        traveler = matchesByJob[0];
      } else if (matchesByJob.length > 1) {
        if (manualEntryData.step_id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          traveler = matchesByJob.find((t: any) =>
            (t.process_steps || []).some((s: any) => s.id === manualEntryData.step_id)
          ) ?? null;
        }
        if (!traveler) {
          toast.error(
            `Job ${manualEntryData.job_number} has ${matchesByJob.length} work orders (different WOs). ` +
            `Select the Work Center for the correct WO before saving.`
          );
          return;
        }
      }

      if (!traveler) {
        toast.error(`Job number ${manualEntryData.job_number} not found`);
        return;
      }

      const startTimeISO = convertLocalToISO(manualEntryData.start_time);
      const endTimeISO = convertLocalToISO(manualEntryData.end_time);

      // Validate that end time is after start time
      if (new Date(endTimeISO) <= new Date(startTimeISO)) {
        toast.error('End time must be after start time');
        return;
      }

      // Create a COMPLETED entry with both start and end times
      // This ensures NO timer is started for manual entries
      const response = await fetch(`${API_BASE_URL}/labor/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          traveler_id: traveler.id,
          start_time: startTimeISO,
          end_time: endTimeISO,  // CRITICAL: End time is set, making this a completed entry
          description: `${manualEntryData.work_center} - ${manualEntryData.operator_name}`,
          is_completed: true,     // CRITICAL: Mark as completed to prevent timer activation
          ...(manualEntryData.step_id ? { step_id: manualEntryData.step_id } : {}),
          ...(manualEntryData.operator_id ? { employee_id: manualEntryData.operator_id } : {}),
          comment: manualEntryData.comment || null,
          qty_completed: manualEntryData.qty_completed ? parseInt(manualEntryData.qty_completed) : null
        })
      });

      if (response.ok) {
        const createdEntry = await response.json();
        // Create pause logs if any were added
        if (manualEntryData.pauses.length > 0) {
          for (const pause of manualEntryData.pauses) {
            const pauseStart = convertLocalToISO(pause.paused_at);
            const pauseEnd = convertLocalToISO(pause.resumed_at);
            await fetch(`${API_BASE_URL}/labor/${createdEntry.id}/pauses`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ paused_at: pauseStart, resumed_at: pauseEnd, comment: pause.comment || null })
            });
          }
        }
        toast.success('Manual entry created successfully!');
        setIsManualEntryOpen(false);
        setManualEntryData({
          job_number: '',
          job_display: '',
          traveler_id: undefined,
          work_center: '',
          step_id: undefined,
          operator_name: '',
          operator_id: undefined,
          start_time: '',
          end_time: '',
          comment: '',
          qty_completed: '',
          pauses: [],
        });
        setManualJobWorkCenterOptions([]);
        // Reload entries but DO NOT check for active entry (to avoid timer activation)
        fetchLaborEntries();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.detail || 'Failed to create entry'}`);
      }
    } catch (error) {
      console.error('Error creating manual entry:', error);
      toast.error('Error creating manual entry');
    }
  };

  // Edit entry handler (ADMIN only)
  const handleEditEntry = async () => {
    if (!editEntryData.id) return;

    // Zero qty must be accompanied by an explanation — same accountability
    // rule as the stop and manual-entry flows.
    if (editEntryData.qty_completed === '0' && !(editEntryData.comment && editEntryData.comment.trim())) {
      toast.error('Please enter a reason in the Comment field when quantity is 0.');
      return;
    }

    try {
      const token = localStorage.getItem('nexus_token');

      const parsedEditQty = editEntryData.qty_completed !== ''
        ? parseInt(editEntryData.qty_completed)
        : null;

      const response = await fetch(`${API_BASE_URL}/labor/${editEntryData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          start_time: editEntryData.start_time,
          end_time: editEntryData.end_time,
          description: `${editEntryData.work_center} - ${editEntryData.operator_name}`,
          comment: editEntryData.comment || null,
          qty_completed: Number.isFinite(parsedEditQty as number) ? parsedEditQty : null
        })
      });

      if (response.ok) {
        toast.success('Entry updated successfully!');
        setIsEditModalOpen(false);
        fetchLaborEntries();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.detail || 'Failed to update entry'}`);
      }
    } catch (error) {
      console.error('Error updating entry:', error);
      toast.error('Error updating entry');
    }
  };

  const openEditModal = (entry: LaborEntry) => {
    setEditEntryData({
      id: entry.id,
      job_number: entry.job_number || '',
      work_center: entry.work_center || entry.description?.split(' - ')?.[0] || '',
      operator_name: entry.employee_name || entry.description?.split(' - ')?.[1] || '',
      start_time: entry.start_time,
      end_time: entry.end_time || new Date().toISOString(),
      comment: entry.comment || '',
      qty_completed: entry.qty_completed != null ? String(entry.qty_completed) : '',
      pause_logs: entry.pause_logs || [],
      newPause: { paused_at: '', resumed_at: '', comment: '' },
    });
    setIsEditModalOpen(true);
  };

  const addPauseToEditEntry = async () => {
    const { paused_at, resumed_at } = editEntryData.newPause;
    if (!paused_at || !resumed_at) {
      toast.error('Please fill in both pause start and end times');
      return;
    }
    const pauseStart = convertLocalToISO(paused_at);
    const pauseEnd = convertLocalToISO(resumed_at);
    if (new Date(pauseEnd) <= new Date(pauseStart)) {
      toast.error('Resume time must be after pause time');
      return;
    }
    try {
      const token = localStorage.getItem('nexus_token');
      const res = await fetch(`${API_BASE_URL}/labor/${editEntryData.id}/pauses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ paused_at: pauseStart, resumed_at: pauseEnd, comment: editEntryData.newPause.comment || null })
      });
      if (res.ok) {
        const data = await res.json();
        setEditEntryData(prev => ({
          ...prev,
          pause_logs: [...prev.pause_logs, { id: data.id, paused_at: pauseStart, resumed_at: pauseEnd, duration_seconds: data.duration_seconds, comment: prev.newPause.comment || undefined }],
          newPause: { paused_at: '', resumed_at: '', comment: '' }
        }));
        fetchLaborEntries();
        toast.success('Pause added');
      } else {
        const err = await res.json();
        toast.error(err.detail || 'Failed to add pause');
      }
    } catch { toast.error('Error adding pause'); }
  };

  const deletePauseFromEditEntry = async (pauseId: number) => {
    try {
      const token = localStorage.getItem('nexus_token');
      const res = await fetch(`${API_BASE_URL}/labor/${editEntryData.id}/pauses/${pauseId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setEditEntryData(prev => ({ ...prev, pause_logs: prev.pause_logs.filter(p => p.id !== pauseId) }));
        fetchLaborEntries();
        toast.success('Pause removed');
      }
    } catch { toast.error('Error removing pause'); }
  };

  // Helper function to convert datetime-local input to ISO string
  // datetime-local values are in format "YYYY-MM-DDTHH:MM" and represent LOCAL time
  const convertLocalToISO = (datetimeLocal: string): string => {
    if (!datetimeLocal) return new Date().toISOString();

    // Create a Date object - this interprets the datetime as local time
    const date = new Date(datetimeLocal);

    // Return ISO string - this will be in UTC
    return date.toISOString();
  };

  // Helper function to convert ISO string to datetime-local format
  const convertISOToLocal = (isoString: string): string => {
    if (!isoString) return '';

    const date = new Date(isoString);

    // Format to YYYY-MM-DDTHH:MM for datetime-local input
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Bulk selection functions
  const toggleSelectEntry = (id: number) => {
    if (selectedEntries.includes(id)) {
      setSelectedEntries(selectedEntries.filter(entryId => entryId !== id));
    } else {
      setSelectedEntries([...selectedEntries, id]);
    }
  };

  const selectAll = () => {
    const currentPageIds = filteredEntries.map(e => e.id);
    const allCurrentPageSelected = currentPageIds.every(id => selectedEntries.includes(id));

    if (allCurrentPageSelected) {
      // Deselect all on current page
      setSelectedEntries(selectedEntries.filter(id => !currentPageIds.includes(id)));
    } else {
      // Select all on current page
      const newSelected = [...selectedEntries];
      currentPageIds.forEach(id => {
        if (!newSelected.includes(id)) {
          newSelected.push(id);
        }
      });
      setSelectedEntries(newSelected);
    }
  };

  const deleteSelected = async () => {
    if (selectedEntries.length === 0) {
      toast.error('Please select entries to delete');
      return;
    }

    try {
      const token = localStorage.getItem('nexus_token');
      await Promise.all(
        selectedEntries.map(id =>
          fetch(`${API_BASE_URL}/labor/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
        )
      );

      toast.success(`Deleted ${selectedEntries.length} entry/entries!`);
      setSelectedEntries([]);
      fetchLaborEntries();
    } catch (error) {
      console.error('Error deleting entries:', error);
      toast.error('Failed to delete entries');
    }
  };

  return (
    <Layout fullWidth>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        <div className="w-full space-y-4 p-2 sm:p-4 lg:p-6">
          {/* Compact Header */}
          <div className="bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 text-white shadow-2xl rounded-2xl p-5 md:p-8 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
            </div>
            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-white/15 backdrop-blur-sm p-3 rounded-xl border border-white/20">
                  <ClockIcon className="w-7 h-7 text-green-300" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Labor Tracking</h1>
                  <p className="text-sm text-teal-200/80 mt-0.5">Real-time production hours</p>
                </div>
              </div>
              {user?.role === 'ADMIN' && (
                <button
                  onClick={() => setIsManualEntryOpen(true)}
                  className="px-4 py-2 sm:px-6 sm:py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white text-sm font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 flex items-center space-x-2"
                >
                  <DocumentTextIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="hidden sm:inline">Manual Entry</span>
                  <span className="sm:hidden">Add</span>
                </button>
              )}
            </div>
          </div>

          {/* Dashboard Grid - Timer and Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Circular Timer - Takes 2 columns on large screens */}
            <div className="md:col-span-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">Timer</h2>
                {isTimerRunning && (
                  <span className="flex items-center space-x-2 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-semibold">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    <span>ACTIVE</span>
                  </span>
                )}
              </div>

              {/* Circular Timer Display */}
              {isTimerRunning && (
                <div className="mb-6 flex flex-col md:flex-row items-center gap-6">
                  {/* Circular Progress */}
                  <div className="relative w-32 h-32 sm:w-40 sm:h-40">
                    {/* Background circle */}
                    <svg className="transform -rotate-90 w-full h-full">
                      <circle
                        cx="50%"
                        cy="50%"
                        r="45%"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        className="text-gray-200 dark:text-slate-700"
                      />
                      {/* Animated progress circle */}
                      <circle
                        cx="50%"
                        cy="50%"
                        r="45%"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray="283"
                        strokeDashoffset={283 - (283 * ((elapsedTime % 3600) / 3600))}
                        className="text-emerald-500 transition-all duration-1000"
                        strokeLinecap="round"
                      />
                    </svg>
                    {/* Center time display */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-slate-100 font-mono">
                        {formatTime(elapsedTime)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-slate-400 mt-1">HH:MM:SS</span>
                    </div>
                  </div>

                  {/* Session Details */}
                  <div className="flex-1 w-full bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-700">
                    <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-3 uppercase tracking-wide">Session Details</p>
                    <div className="space-y-2">
                      <div className="flex items-start space-x-2">
                        <DocumentTextIcon className="w-4 h-4 text-gray-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500 dark:text-slate-400">Job Number</p>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{newEntry.job_display || newEntry.job_number}</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <ClockIcon className="w-4 h-4 text-gray-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500 dark:text-slate-400">Work Center</p>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{newEntry.work_center}</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <UserIcon className="w-4 h-4 text-gray-600 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500 dark:text-slate-400">Operator</p>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">{newEntry.operator_name}</p>
                        </div>
                      </div>
                      {isPaused && pauseTime && (
                        <div className="flex items-start space-x-2 pt-2 border-t border-emerald-200">
                          <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-amber-600 font-semibold">PAUSED</p>
                            <p className="text-xs text-gray-600 dark:text-slate-400">
                              Since {new Date(pauseTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Input Form */}
              <div className="relative z-[50] grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4">
                <div>
                  <label className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    <span>Job Number <span className="text-red-500">*</span></span>
                    {scannedWorkOrder && (
                      <span
                        title="WO resolved from the scanned Work Center QR — confirm it matches the traveler in front of you"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px] font-bold dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700"
                      >
                        WO {scannedWorkOrder}
                      </span>
                    )}
                  </label>
                  <Autocomplete
                    ref={jobNumberAutocompleteRef}
                    value={newEntry.job_display || newEntry.job_number}
                    onChange={handleJobNumberChange}
                    onSelect={handleJobNumberSelect}
                    fetchSuggestions={fetchJobNumbers}
                    placeholder="Type or scan job #"
                    disabled={isTimerRunning}
                    autoFocus={!isTimerRunning && !newEntry.job_number}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all disabled:bg-gray-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed dark:bg-slate-700 dark:text-slate-200"
                    minChars={0}
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    Work Center <span className="text-red-500">*</span>
                  </label>
                  <Autocomplete
                    ref={workCenterAutocompleteRef}
                    value={newEntry.work_center}
                    onChange={(value) => {
                      if (!isTimerRunning) {
                        setNewEntry(prev => ({ ...prev, work_center: value, step_id: undefined }));
                        setWorkCenterConfirmed(false);
                      }
                    }}
                    onSelect={async (option: any) => {
                      let selectedWC = option.value || option.label;
                      let stepId = option.step_id;

                      // QR code scan: call backend to resolve DB metrics instead of text parsing
                      if (selectedWC.startsWith('NEXUS-STEP|')) {
                        try {
                          const token = localStorage.getItem('nexus_token');
                          const scanResp = await fetch(
                            `${API_BASE_URL}/labor/scan?qr_data=${encodeURIComponent(selectedWC)}`,
                            { headers: { 'Authorization': `Bearer ${token || 'mock-token'}` } }
                          );
                          if (!scanResp.ok) {
                            const err = await scanResp.json().catch(() => ({}));
                            toast.error(`Scan error: ${err.detail || 'Failed to look up step'}`);
                            return;
                          }
                          const scanData = await scanResp.json();

                          // Use operation name from DB (e.g. "AOI", "FEEDER LOAD") — NOT work_center_code
                          selectedWC = scanData.operation;
                          stepId = scanData.step_id;

                          // Auto-stop if timer is running and same step scanned
                          if (isTimerRunning) {
                            if (
                              scanData.step_id === lastStartedStepIdRef.current ||
                              scanData.work_center_code === lastStartedWorkCenterCodeRef.current ||
                              scanData.operation.toLowerCase() === lastStartedWorkCenterRef.current.toLowerCase()
                            ) {
                              stopTimer();
                            }
                            return;
                          }

                          // Pin the exact traveler_id from the scan so
                          // startTimer can use it directly instead of guessing
                          // by job_number (which is ambiguous when multiple
                          // travelers share a job — different WO breakouts).
                          if (typeof scanData.traveler_id === 'number') {
                            scannedTravelerIdRef.current = scanData.traveler_id;
                          }
                          setScannedWorkOrder(scanData.work_order || null);
                          // Auto-fill job number from DB
                          setNewEntry(prev => ({
                            ...prev,
                            job_number: scanData.job_number || prev.job_number,
                            // Without this the banner keeps the PREVIOUS scan's
                            // label — an RMA scan would show the wrong job.
                            job_display: scanData.job_display || scanData.job_number || prev.job_display,
                            work_center: scanData.operation, // display name like "AOI"
                            step_id: scanData.step_id,
                          }));
                          setWorkCenterConfirmed(true);

                          // Intentionally NOT warning on completed steps —
                          // operators legitimately rescan to log additional
                          // time. The toast was just noise.

                          // Fetch work center options for this job
                          if (scanData.job_number) {
                            const steps = await fetchWorkCentersByJob(scanData.job_number, '', scannedTravelerIdRef.current);
                            setJobWorkCenterOptions(steps);
                          }

                          return;
                        } catch (error) {
                          console.error('QR scan lookup failed:', error);
                          toast.error('Failed to look up scanned data');
                          return;
                        }
                      }

                      if (isTimerRunning) {
                        // Non-QR selection while timer running — check for match
                        if (selectedWC.toLowerCase() === lastStartedWorkCenterRef.current.toLowerCase()) {
                          stopTimer();
                        }
                        return;
                      }
                      setNewEntry(prev => ({ ...prev, work_center: selectedWC, step_id: stepId }));
                      setWorkCenterConfirmed(true);
                      // A Work Center was picked without a Job Number in context
                      // (e.g. generic WC barcode). Pull focus back to Job Number
                      // so the next scan lands there and the timer can't start
                      // without a job attached.
                      if (!newEntry.job_number.trim()) {
                        requestAnimationFrame(() => jobNumberAutocompleteRef.current?.select());
                        toast.info('Scan or select a Job Number to continue');
                      }
                    }}
                    fetchSuggestions={async (query) => {
                      // If job number is set, fetch work centers from its process steps.
                      // Pass the pinned traveler — without it this refetch drops the
                      // pin set at job selection and falls back to the first traveler
                      // sharing the job_number (the non-RMA one).
                      if (newEntry.job_number) {
                        const jobSteps = await fetchWorkCentersByJob(newEntry.job_number, query, scannedTravelerIdRef.current, newEntry.job_display);
                        if (jobSteps.length > 0) {
                          // Also include general work centers as fallback
                          const generalWCs = await fetchWorkCenters(query);
                          const existingValues = new Set(jobSteps.map((f: any) => f.value));
                          return [
                            ...jobSteps,
                            ...generalWCs.filter((wc: any) => !existingValues.has(wc.value))
                          ];
                        }
                      }
                      return fetchWorkCenters(query);
                    }}
                    placeholder={isTimerRunning ? "Timer running — scan to stop" : "Type, scan, or select"}
                    disabled={isTimerRunning}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all dark:bg-slate-700 dark:text-slate-200"
                    minChars={0}
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    Operator <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newEntry.operator_name}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-gray-100 dark:bg-slate-700 cursor-not-allowed dark:text-white font-bold text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={newEntry.date}
                    onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                    disabled={isTimerRunning}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all disabled:bg-gray-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed dark:bg-slate-700 dark:text-slate-200"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {!isTimerRunning ? (
                  <button
                    onClick={startTimer}
                    disabled={!newEntry.job_number.trim() || !newEntry.work_center.trim() || !workCenterConfirmed || !newEntry.operator_name.trim()}
                    className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 flex items-center space-x-2"
                  >
                    <PlayIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Start</span>
                  </button>
                ) : (
                  <>
                    {!isPaused ? (
                      <>
                        <button
                          onClick={pauseTimer}
                          className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 flex items-center space-x-2"
                        >
                          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Pause</span>
                        </button>
                        {/* Waiting-on-parts pause — only relevant for kitting.
                            Visibility uses the actively-running entry's work
                            center (not the form), so it disappears immediately
                            when stopping a kitting timer. */}
                        {isTimerRunning && activeEntryId && (lastStartedWorkCenterRef.current || newEntry.work_center || '').toUpperCase().includes('KIT') && (
                          <button
                            onClick={pauseWaitingParts}
                            title="Pause and mark this job as waiting on parts"
                            className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 flex items-center space-x-2"
                          >
                            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="hidden sm:inline">Waiting Parts</span>
                            <span className="sm:hidden">Wait</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={resumeTimer}
                        className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 flex items-center space-x-2"
                      >
                        <PlayIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span>Resume</span>
                      </button>
                    )}
                    <button
                      onClick={stopTimer}
                      className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 flex items-center space-x-2"
                    >
                      <StopIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="hidden sm:inline">End & Save</span>
                      <span className="sm:hidden">Stop</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Quick Stats Cards - Right Column */}
            <div className="space-y-4">
              {/* Total Entries Card */}
              <div className="bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase">Entries</p>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-slate-100 mt-1">{laborEntries.length}</p>
                  </div>
                  <DocumentTextIcon className="w-8 h-8 text-blue-500" />
                </div>
              </div>

              {/* Total Hours Card */}
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase">Total Hours</p>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-slate-100 mt-1">{getTotalHours()}</p>
                  </div>
                  <ClockIcon className="w-8 h-8 text-emerald-500" />
                </div>
              </div>

              {/* Operators Card */}
              <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase">Operators</p>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-slate-100 mt-1">
                      {new Set(laborEntries.map(e => e.employee_name)).size}
                    </p>
                  </div>
                  <UserIcon className="w-8 h-8 text-purple-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Job Summary — Filter Card */}
          {(() => {
            // Get unique job numbers from labor entries
            // RMA travelers chip as their full job number ("1080B RMA JOB NO
            // 8656"), so an RMA and the job it reworks stay separate chips.
            const uniqueJobs = Array.from(new Set(
              laborEntries.map(entry => entry.job_display || entry.job_number || `Traveler #${entry.traveler_id}`)
            )).sort();

            // Filter job chips by the summary search
            const visibleJobs = summaryJobSearch
              ? uniqueJobs.filter(job => job.toLowerCase().includes(summaryJobSearch.toLowerCase()))
              : uniqueJobs;

            return (
              <div className="relative z-[10] bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100 flex items-center">
                    <svg className="w-4 h-4 mr-1.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Job Summary
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-slate-400">({uniqueJobs.length} jobs)</span>
                  </h3>
                  {/* Clear all filters button */}
                  {(selectedJobChip || filter.operatorName || filter.startDate || filter.endDate) && (
                    <button
                      onClick={() => {
                        setSelectedJobChip(null);
                        setSummaryJobSearch('');
                        setFilter({ jobNumber: '', workCenter: '', operatorName: '', startDate: '', endDate: '', startTime: '', endTime: '' });
                      }}
                      className="text-xs px-2.5 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded-full hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium"
                    >
                      ✕ Clear All Filters
                    </button>
                  )}
                </div>

                {/* Search & Filter Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-1">Search Job Number</label>
                    <input
                      type="text"
                      value={summaryJobSearch}
                      onChange={(e) => setSummaryJobSearch(e.target.value)}
                      placeholder="Search jobs..."
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-1">Operator Name</label>
                    <input
                      type="text"
                      value={filter.operatorName}
                      onChange={(e) => setFilter({ ...filter, operatorName: e.target.value })}
                      placeholder="Filter by operator..."
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={filter.startDate}
                      onChange={(e) => setFilter({ ...filter, startDate: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 dark:text-slate-400 mb-1">End Date</label>
                    <input
                      type="date"
                      value={filter.endDate}
                      onChange={(e) => setFilter({ ...filter, endDate: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                    />
                  </div>
                </div>

                {/* Job Number Chips — Collapsible */}
                <div className="border-t border-gray-200 dark:border-slate-600 pt-2">
                  <button
                    onClick={() => setJobListExpanded(!jobListExpanded)}
                    className="flex items-center text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors mb-2"
                  >
                    <svg
                      className={`w-3.5 h-3.5 mr-1 transition-transform ${jobListExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {jobListExpanded ? 'Hide' : 'Show'} Job Numbers ({visibleJobs.length})
                  </button>

                  {jobListExpanded && (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleJobs.length > 0 ? visibleJobs.map((job) => (
                        <button
                          key={job}
                          onClick={() => {
                            if (selectedJobChip === job) {
                              setSelectedJobChip(null);
                              setFilter(prev => ({ ...prev, jobNumber: '' }));
                            } else {
                              setSelectedJobChip(job);
                              setFilter(prev => ({ ...prev, jobNumber: job }));
                            }
                          }}
                          className={`px-2.5 py-1 rounded-md border text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                            selectedJobChip === job
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-200 border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-slate-600'
                          }`}
                        >
                          {job}
                        </button>
                      )) : (
                        <p className="w-full text-sm text-gray-400 dark:text-slate-500 italic text-center py-2">No jobs match your search</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Active filter summary */}
                {(selectedJobChip || filter.operatorName || filter.startDate || filter.endDate) && (
                  <div className="mt-3 pt-2 border-t border-gray-200 dark:border-slate-600 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">Active:</span>
                    {selectedJobChip && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                        Job: {selectedJobChip}
                        <button onClick={() => { setSelectedJobChip(null); setFilter(prev => ({ ...prev, jobNumber: '' })); }} className="ml-1 hover:text-blue-900 dark:hover:text-blue-100">✕</button>
                      </span>
                    )}
                    {filter.operatorName && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                        Operator: {filter.operatorName}
                        <button onClick={() => setFilter(prev => ({ ...prev, operatorName: '' }))} className="ml-1 hover:text-purple-900 dark:hover:text-purple-100">✕</button>
                      </span>
                    )}
                    {filter.startDate && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full">
                        From: {filter.startDate}
                        <button onClick={() => setFilter(prev => ({ ...prev, startDate: '' }))} className="ml-1 hover:text-emerald-900 dark:hover:text-emerald-100">✕</button>
                      </span>
                    )}
                    {filter.endDate && (
                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full">
                        To: {filter.endDate}
                        <button onClick={() => setFilter(prev => ({ ...prev, endDate: '' }))} className="ml-1 hover:text-emerald-900 dark:hover:text-emerald-100">✕</button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Bulk Action Buttons */}
          {user?.role === 'ADMIN' && (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg border-2 border-gray-200 dark:border-slate-700 p-4">
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <button
                  onClick={selectAll}
                  className="flex items-center justify-center space-x-2 px-3 md:px-4 py-2 bg-gray-600 dark:bg-slate-500 hover:bg-gray-700 dark:hover:bg-slate-400 text-white rounded-lg font-semibold shadow-md text-sm md:text-base"
                >
                  <CheckIcon className="h-4 md:h-5 w-4 md:w-5" />
                  <span>{selectedEntries.length === filteredEntries.length && filteredEntries.length > 0 ? 'Deselect All' : 'Select All'}</span>
                </button>

                <button
                  onClick={deleteSelected}
                  disabled={selectedEntries.length === 0}
                  className="flex items-center justify-center space-x-2 px-3 md:px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-slate-600 text-white rounded-lg font-semibold shadow-md disabled:cursor-not-allowed text-sm md:text-base"
                >
                  <TrashIcon className="h-4 md:h-5 w-4 md:w-5" />
                  <span>Delete ({selectedEntries.length})</span>
                </button>

                {selectedEntries.length > 0 && (
                  <div className="ml-auto px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                      {selectedEntries.length} selected
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Labor Entries */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            {/* Table Header + Pagination */}
            <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 rounded-t-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute top-0 right-0 w-20 h-20 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-14 h-14 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
              </div>
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xs sm:text-sm font-bold text-white">Labor Entries</h2>
                  <span className="text-xs font-semibold text-white bg-white/20 px-2 py-0.5 rounded-full">
                    {filteredEntries.length}
                  </span>
                  {manualOrder && (
                    <button
                      onClick={() => setManualOrder(false)}
                      className="text-[10px] font-medium text-white/80 bg-white/15 hover:bg-white/25 px-2 py-0.5 rounded-full transition-colors"
                    >
                      Reset order
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] sm:text-xs font-semibold text-white/90 uppercase tracking-wider">Sort:</label>
                  <select
                    value={sortField}
                    onChange={(e) => { setManualOrder(false); setSortField(e.target.value as LaborSortField); }}
                    className="text-xs font-semibold bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50"
                  >
                    <option value="date" className="text-gray-900">Date</option>
                    <option value="job" className="text-gray-900">Job</option>
                    <option value="work_order" className="text-gray-900">Work Order</option>
                    <option value="operator" className="text-gray-900">Operator</option>
                    <option value="work_center" className="text-gray-900">Work Center</option>
                    <option value="start" className="text-gray-900">Start</option>
                    <option value="end" className="text-gray-900">End</option>
                    <option value="hours" className="text-gray-900">Total Hours</option>
                    <option value="qty" className="text-gray-900">Qty</option>
                  </select>
                  <button
                    onClick={() => { setManualOrder(false); setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }}
                    className="text-xs font-bold bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded px-2 py-1 transition-colors"
                    title={sortDirection === 'asc' ? 'Ascending — click for Descending' : 'Descending — click for Ascending'}
                  >
                    {sortDirection === 'asc' ? '▲ Asc' : '▼ Desc'}
                  </button>
                </div>
              </div>
            </div>

            {/* Card View - the default for everyone else */}
            <div className={`${useTableView ? 'hidden' : 'block'} overflow-hidden`}>
              {isLoading ? (
                <div className="p-4"><div className="space-y-3">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-12 w-full" />)}</div></div>
              ) : filteredEntries.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
                    <ClockIcon className="w-7 h-7 text-gray-400 dark:text-slate-500" />
                  </div>
                  <h3 className="text-base font-medium text-gray-900 dark:text-slate-200 mb-2">
                    {laborEntries.length === 0 ? 'No Labor Entries Yet' : 'No Matching Entries'}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {laborEntries.length === 0
                      ? 'Use the timer above to start tracking labor hours.'
                      : 'Try adjusting your filters to see more entries.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
                  {paginatedEntries.map((entry) => {
                    const workCenter = entry.work_center || entry.description?.split(' - ')?.[0] || 'N/A';
                    const operatorName = entry.employee_name || entry.description?.split(' - ')?.[1] || 'N/A';
                    const sequenceDisplay = entry.sequence_number ? `${entry.sequence_number}. ${workCenter}` : workCenter;

                    return (
                      <div key={entry.id} className="p-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700 transition-all">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
                              <DocumentTextIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />
                              <span className="font-bold text-gray-900 dark:text-slate-100 text-base">{entry.job_display || entry.job_number || `Traveler #${entry.traveler_id}`}</span>
                              {entry.work_order && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                                  WO {entry.work_order}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-slate-400">
                              <UserIcon className="w-4 h-4 flex-shrink-0" />
                              <span className="truncate">{operatorName}</span>
                            </div>
                          </div>
                          {user?.role === 'ADMIN' && (
                            <div className="relative">
                              <button
                                onClick={() => {
                                  const btn = document.getElementById(`labor-menu-${entry.id}`);
                                  btn?.classList.toggle('hidden');
                                }}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                              >
                                <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                </svg>
                              </button>
                              <div id={`labor-menu-${entry.id}`} className="hidden absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 z-10">
                                <button
                                  onClick={() => {
                                    setSelectedEntry(entry);
                                    setIsModalOpen(true);
                                    document.getElementById(`labor-menu-${entry.id}`)?.classList.add('hidden');
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center space-x-2"
                                >
                                  <EyeIcon className="w-4 h-4 text-blue-600" />
                                  <span>View Details</span>
                                </button>
                                <button
                                  onClick={() => {
                                    openEditModal(entry);
                                    document.getElementById(`labor-menu-${entry.id}`)?.classList.add('hidden');
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center space-x-2"
                                >
                                  <PencilIcon className="w-4 h-4 text-green-600" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setEntryToDelete(entry);
                                    setIsDeleteModalOpen(true);
                                    document.getElementById(`labor-menu-${entry.id}`)?.classList.add('hidden');
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center space-x-2 text-red-600"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Work Center</p>
                            <span className="inline-block mt-1 px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full">
                              {sequenceDisplay}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Total Hours</p>
                            <p className="text-sm font-bold text-emerald-600 mt-1">{formatHoursDualCompact(entry.hours_worked)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Date</p>
                            <p className="text-sm text-gray-900 dark:text-slate-100 mt-1">{new Date(entry.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Start Time</p>
                            <p className="text-sm text-gray-900 dark:text-slate-100 mt-1">{new Date(entry.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Pauses</p>
                            {(entry.pause_count || 0) > 0 ? (
                              <div className="mt-1">
                                <span className="inline-block px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-md font-semibold text-xs">
                                  {entry.pause_count}x &middot; {formatSecondsCompact(entry.total_pause_seconds || 0)}
                                </span>
                                {(entry.pause_logs || []).length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {(entry.pause_logs || []).map((pl, idx) => (
                                      <div key={pl.id} className="text-[11px] text-gray-600 dark:text-slate-400 flex items-center gap-1">
                                        <span className="text-gray-400 font-mono">#{idx + 1}</span>
                                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                                          {pl.duration_seconds ? formatSecondsCompact(pl.duration_seconds) : 'active'}
                                        </span>
                                        {pl.comment && <span className="truncate max-w-[120px]" title={pl.comment}>- {pl.comment}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">0</p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">End Time</p>
                            <p className="text-sm text-gray-900 dark:text-slate-100 mt-1">
                              {entry.end_time ? new Date(entry.end_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) : '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Qty</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-1">
                              {entry.qty_completed ?? '-'}
                            </p>
                          </div>
                        </div>
                        {entry.comment && (
                          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400 rounded text-xs text-gray-700 dark:text-slate-300">
                            <span className="font-semibold text-amber-700 dark:text-amber-300">Comment: </span>
                            {entry.comment}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dense table view — dashboard "Traveler Status & Progress" look */}
            <div className={useTableView ? 'block' : 'hidden'}>
              <div>
              {isLoading ? (
                <div className="p-4"><div className="space-y-3">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-12 w-full" />)}</div></div>
              ) : filteredEntries.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
                    <ClockIcon className="w-7 h-7 text-gray-400 dark:text-slate-500" />
                  </div>
                  <h3 className="text-base font-medium text-gray-900 dark:text-slate-200 mb-2">
                    {laborEntries.length === 0 ? 'No Labor Entries Yet' : 'No Matching Entries'}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {laborEntries.length === 0
                      ? 'Use the timer above to start tracking labor hours.'
                      : 'Try adjusting your filters to see more entries.'}
                  </p>
                </div>
              ) : (
                <div className="relative overflow-x-auto">
                <div className="absolute top-0 left-0 right-0 h-12 overflow-hidden pointer-events-none z-20">
                  <div className="absolute top-0 right-8 w-20 h-20 bg-white/10 rounded-full -translate-y-1/2" />
                  <div className="absolute top-2 left-12 w-12 h-12 bg-white/10 rounded-full" />
                  <div className="absolute top-0 right-1/3 w-8 h-8 bg-white/5 rounded-full translate-y-1" />
                </div>
                <table className="min-w-[800px] w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800">
                      {user?.role === 'ADMIN' && (
                        <th className="px-1 py-3 text-center text-xs font-extrabold text-white uppercase tracking-wider w-8" title="Drag to reorder">
                          <svg className="w-4 h-4 mx-auto text-white/60" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
                        </th>
                      )}
                      {user?.role === 'ADMIN' && (
                        <th className="px-3 py-3 text-left text-xs font-extrabold text-white uppercase tracking-wider">
                          <input
                            type="checkbox"
                            checked={filteredEntries.length > 0 && filteredEntries.every(e => selectedEntries.includes(e.id))}
                            onChange={selectAll}
                            className="h-5 w-5 text-blue-600 rounded cursor-pointer"
                          />
                        </th>
                      )}
                      <SortableTh field="date" label="Date" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="job" label="Job" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="work_order" label="Work Order" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="operator" label="Operator" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="work_center" label="Work Center" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="start" label="Start" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <th className="px-4 py-3 text-left text-xs font-extrabold text-white uppercase tracking-wider">Pause</th>
                      <SortableTh field="end" label="End" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="hours" label="Total Hours" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableTh field="qty" label="Qty" align="center" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                      {user?.role === 'ADMIN' && (
                        <th className="px-4 py-3 text-center text-xs font-extrabold text-white uppercase tracking-wider">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                    {paginatedEntries.map((entry) => {
                      const workCenter = entry.work_center || entry.description?.split(' - ')?.[0] || 'N/A';
                      const operatorName = entry.employee_name || entry.description?.split(' - ')?.[1] || 'N/A';
                      const sequenceDisplay = entry.sequence_number ? `${entry.sequence_number}. ${workCenter}` : workCenter;

                      // Pause data from API
                      const pauseCount = entry.pause_count || 0;
                      const totalPauseSecs = entry.total_pause_seconds || 0;
                      const totalPauseHours = totalPauseSecs / 3600;

                      const hasComment = !!entry.comment;
                      const totalCols = 10 + (user?.role === 'ADMIN' ? 2 : 0);
                      const rowBg = selectedEntries.includes(entry.id)
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-500'
                        : 'hover:bg-blue-50/30 dark:hover:bg-slate-700/50';

                      return (
                        <React.Fragment key={entry.id}>
                        <tr
                          className={`transition-colors ${rowBg} ${hasComment ? 'border-b-0' : ''} ${draggedId === entry.id ? 'opacity-40' : ''} ${dragOverId === entry.id ? 'border-t-2 border-t-blue-500' : ''}`}
                          draggable={user?.role === 'ADMIN'}
                          onDragStart={(e) => { if (user?.role === 'ADMIN') { setDraggedId(entry.id); e.dataTransfer.effectAllowed = 'move'; } }}
                          onDragOver={(e) => { if (user?.role === 'ADMIN') { e.preventDefault(); setDragOverId(entry.id); } }}
                          onDragLeave={() => setDragOverId(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverId(null);
                            if (!draggedId || draggedId === entry.id) { setDraggedId(null); return; }
                            // Reorder in local state only — no date changes
                            setLaborEntries(prev => {
                              const arr = [...prev];
                              const fromIdx = arr.findIndex(le => le.id === draggedId);
                              const toIdx = arr.findIndex(le => le.id === entry.id);
                              if (fromIdx === -1 || toIdx === -1) return prev;
                              const [moved] = arr.splice(fromIdx, 1);
                              arr.splice(toIdx, 0, moved);
                              return arr;
                            });
                            setManualOrder(true);
                            toast.success('Entries reordered');
                            setDraggedId(null);
                          }}
                          onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                        >
                          {user?.role === 'ADMIN' && (
                            <td className={`px-1 py-3 whitespace-nowrap text-center cursor-grab active:cursor-grabbing ${hasComment ? 'pb-0' : ''}`} rowSpan={hasComment ? 2 : 1}>
                              <svg className="w-4 h-4 mx-auto text-gray-400 dark:text-slate-500" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
                            </td>
                          )}
                          {user?.role === 'ADMIN' && (
                            <td className={`px-3 py-3 whitespace-nowrap ${hasComment ? 'pb-0' : ''}`} rowSpan={hasComment ? 2 : 1}>
                              <input
                                type="checkbox"
                                checked={selectedEntries.includes(entry.id)}
                                onChange={() => toggleSelectEntry(entry.id)}
                                className="h-5 w-5 text-blue-600 rounded cursor-pointer"
                              />
                            </td>
                          )}
                          <td className={`px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-slate-300 ${hasComment ? 'pb-1' : ''}`}>
                            {new Date(entry.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap ${hasComment ? 'pb-1' : ''}`}>
                            <div className="flex items-center space-x-2">
                              <DocumentTextIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <span className="font-semibold text-gray-900 dark:text-slate-100 text-sm">{entry.job_display || entry.job_number || `Traveler #${entry.traveler_id}`}</span>
                            </div>
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400 font-medium ${hasComment ? 'pb-1' : ''}`}>
                            {entry.work_order || '-'}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-slate-300 ${hasComment ? 'pb-1' : ''}`}>
                            {operatorName}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap ${hasComment ? 'pb-1' : ''}`}>
                            <span className="px-2.5 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full">
                              {sequenceDisplay}
                            </span>
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400 ${hasComment ? 'pb-1' : ''}`}>
                            {new Date(entry.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className={`px-4 py-3 text-sm ${hasComment ? 'pb-1' : ''}`}>
                            {pauseCount > 0 ? (
                              <div className="group relative">
                                <div className="flex items-center gap-1.5 cursor-default">
                                  <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-md font-semibold text-xs">
                                    {formatSecondsCompact(totalPauseSecs)}
                                  </span>
                                  <span className="text-[10px] text-gray-500 dark:text-slate-400 whitespace-nowrap">{pauseCount}x</span>
                                </div>
                                {/* Hover tooltip showing each individual pause */}
                                {(entry.pause_logs || []).length > 0 && (
                                  <div className="hidden group-hover:block absolute z-[9999] left-0 top-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl p-2.5 min-w-[200px] max-w-[280px]">
                                    <div className="text-[11px] font-bold text-gray-700 dark:text-slate-200 mb-1.5 border-b border-gray-100 dark:border-slate-700 pb-1">
                                      {pauseCount} Pause{pauseCount > 1 ? 's' : ''} &middot; Total: {formatSecondsCompact(totalPauseSecs)}
                                    </div>
                                    <div className="space-y-1 max-h-[180px] overflow-y-auto">
                                      {(entry.pause_logs || []).map((pl, idx) => (
                                        <div key={pl.id} className="flex items-start gap-1.5 text-[11px]">
                                          <span className="text-gray-400 dark:text-slate-500 font-mono shrink-0">#{idx + 1}</span>
                                          <span className="font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                                            {pl.duration_seconds ? formatSecondsCompact(pl.duration_seconds) : 'active'}
                                          </span>
                                          {pl.comment && (
                                            <span className="text-gray-500 dark:text-slate-400 truncate" title={pl.comment}>- {pl.comment}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 dark:text-slate-500">0</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-slate-400 ${hasComment ? 'pb-1' : ''}`}>
                            {entry.end_time ? new Date(entry.end_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap ${hasComment ? 'pb-1' : ''}`}>
                            <div className="flex items-center space-x-1 text-sm font-bold text-emerald-600">
                              <ClockIcon className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                              <span>{formatHoursDualCompact(entry.hours_worked)}</span>
                            </div>
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap text-center text-sm font-semibold text-gray-700 dark:text-slate-300 ${hasComment ? 'pb-1' : ''}`}>
                            {entry.qty_completed != null ? entry.qty_completed : '-'}
                          </td>
                          {user?.role === 'ADMIN' && (
                            <td className={`px-4 py-3 whitespace-nowrap ${hasComment ? 'pb-1' : ''}`} rowSpan={hasComment ? 2 : 1}>
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => {
                                    openEditModal(entry);
                                  }}
                                  className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <PencilIcon className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setEntryToDelete(entry);
                                    setIsDeleteModalOpen(true);
                                  }}
                                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <TrashIcon className="w-5 h-5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        {hasComment && (
                          <tr className={`${rowBg}`}>
                            <td colSpan={totalCols - (user?.role === 'ADMIN' ? 2 : 0)} className="px-4 pt-0 pb-2">
                              <div className="flex items-center gap-2 ml-0">
                                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                                <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">{operatorName}:</span>
                                <span className="text-xs text-amber-700 dark:text-amber-300 italic">{entry.comment}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
              </div>
            </div>

            {/* Bottom Pagination */}
            {filteredEntries.length > 0 && (
              <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-emerald-800 px-3 py-2 relative overflow-hidden rounded-b-xl">
                <div className="absolute inset-0 opacity-10 pointer-events-none">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="absolute bottom-0 left-0 w-12 h-12 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
                </div>
                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="pagination-select">
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span className="text-xs text-white/80">{startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredEntries.length)} of {filteredEntries.length}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
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
          </div>
        </div>
      </div>

      {/* View Details Modal */}
      {selectedEntry && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedEntry(null);
          }}
          title={`Labor Entry #${selectedEntry.id}`}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Job Number</label>
                <p className="text-base text-gray-900 dark:text-slate-100 mt-1">
                  {selectedEntry.job_display || selectedEntry.job_number || `Traveler #${selectedEntry.traveler_id}`}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Operator</label>
                <p className="text-base text-gray-900 dark:text-slate-100 mt-1">
                  {selectedEntry.description?.split(' - ')[1] || selectedEntry.employee_name}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Work Center</label>
                <p className="text-base text-gray-900 dark:text-slate-100 mt-1">
                  {selectedEntry.sequence_number
                    ? `${selectedEntry.sequence_number}. ${selectedEntry.description?.split(' - ')[0] || selectedEntry.work_center}`
                    : selectedEntry.description?.split(' - ')[0] || selectedEntry.work_center || 'N/A'}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Total Hours</label>
                <p className="text-base font-semibold text-emerald-600 mt-1">
                  {formatHoursDual(selectedEntry.hours_worked)}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
              <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Start Time</label>
              <p className="text-base text-gray-900 dark:text-slate-100 mt-1">
                {new Date(selectedEntry.start_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })}
              </p>
            </div>

            {selectedEntry.pause_time && (
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">Pause Started</label>
                <p className="text-base text-yellow-600 mt-1">
                  {new Date(selectedEntry.pause_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })}
                </p>
                {selectedEntry.end_time && (() => {
                  const pauseStart = new Date(selectedEntry.pause_time).getTime();
                  const endTime = new Date(selectedEntry.end_time).getTime();
                  const pauseDuration = Math.round((endTime - pauseStart) / 3600000 * 100) / 100;
                  return pauseDuration > 0 ? (
                    <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                      Duration: <span className="font-semibold text-yellow-600">{pauseDuration.toFixed(2)} hours</span>
                    </p>
                  ) : null;
                })()}
              </div>
            )}

            {selectedEntry.end_time && (
              <div>
                <label className="text-sm font-semibold text-gray-600 dark:text-slate-400">End Time</label>
                <p className="text-base text-gray-900 dark:text-slate-100 mt-1">
                  {new Date(selectedEntry.end_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })}
                </p>
              </div>
            )}

            {!selectedEntry.end_time && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  ⏱️ This entry is still in progress
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {entryToDelete && (
        <Modal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false);
            setEntryToDelete(null);
          }}
          title="Delete Labor Entry"
        >
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800 font-medium">
                Are you sure you want to delete this labor entry?
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Job Number:</span>
                <span className="text-sm text-gray-900 dark:text-slate-100">{entryToDelete.job_display || entryToDelete.job_number || `Traveler #${entryToDelete.traveler_id}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Operator:</span>
                <span className="text-sm text-gray-900 dark:text-slate-100">
                  {entryToDelete.description?.split(' - ')[1] || entryToDelete.employee_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Work Center:</span>
                <span className="text-sm text-gray-900 dark:text-slate-100">
                  {entryToDelete.sequence_number
                    ? `${entryToDelete.sequence_number}. ${entryToDelete.description?.split(' - ')[0] || entryToDelete.work_center}`
                    : entryToDelete.description?.split(' - ')[0] || entryToDelete.work_center || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Hours Worked:</span>
                <span className="text-sm font-semibold text-emerald-600">
                  {formatHoursDual(entryToDelete.hours_worked)}
                </span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setEntryToDelete(null);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
              >
                Delete Entry
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Pause Comment Modal (optional comment) */}
      <Modal
        isOpen={showPauseCommentModal}
        onClose={() => { setShowPauseCommentModal(false); setPauseComment(''); }}
        title={pauseAction === 'pause' ? 'Pause Timer' : 'Resume Timer'}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {pauseAction === 'pause' ? 'Add an optional comment for this pause:' : 'Add an optional comment:'}
          </p>
          <textarea
            value={pauseComment}
            onChange={(e) => setPauseComment(e.target.value)}
            placeholder="Optional comment (e.g., lunch break, waiting for parts...)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 text-sm resize-none"
            rows={2}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowPauseCommentModal(false); setPauseComment(''); }}
              className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setShowPauseCommentModal(false);
                if (pauseAction === 'pause') {
                  executePause(pauseComment);
                } else {
                  executeResume(pauseComment);
                }
                setPauseComment('');
              }}
              className={`px-4 py-2 text-sm font-semibold text-white rounded-lg ${
                pauseAction === 'pause'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {pauseAction === 'pause' ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Qty Completed Modal */}
      <Modal
        isOpen={isQtyModalOpen}
        onClose={() => {
          setIsQtyModalOpen(false);
          setPendingStopEntryId(null);
          setQtyCompleted('');
          setStopComment('');
        }}
        title="Quantity Completed & Comment"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            How many units did you complete during this time? <span className="text-red-500 text-xs">(required — enter 0 with a reason if none were completed)</span>
            {travelerMaxQty != null && (
              <span className="block mt-1 font-semibold text-blue-600 dark:text-blue-400">
                Traveler quantity: {travelerMaxQty}
              </span>
            )}
          </p>
          <input
            type="number"
            min="0"
            value={qtyCompleted}
            onChange={(e) => {
              const val = e.target.value;
              // Reject pasted/scanned QR content. The qty modal auto-focuses
              // this input, so a habitual scan of the Work Center QR to
              // "confirm stop" fires keystrokes here — that landed a garbage
              // string in qty and made the first Stop attempt fail validation
              // (second attempt worked because the operator then cleared and
              // retyped). Strip anything that isn't a digit.
              if (/[^0-9]/.test(val)) {
                setQtyCompleted(val.replace(/[^0-9]/g, ''));
                return;
              }
              setQtyCompleted(val);
            }}
            placeholder={travelerMaxQty != null ? `Traveler qty: ${travelerMaxQty}` : 'Enter quantity completed'}
            className="w-full px-4 py-3 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-lg font-semibold focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:bg-slate-700 dark:text-white"
            autoFocus
            onKeyDown={(e) => {
              // Only submit on Enter when the current qty value is actually
              // valid. Without this guard, a scanner emitting NEXUS-STEP|...
              // into the focused qty field would end with Enter and fire
              // confirmStopTimer with garbage in the qty — producing the
              // "first stop fails" symptom reported from the floor.
              if (e.key !== 'Enter') return;
              const trimmed = qtyCompleted.trim();
              if (!/^\d+$/.test(trimmed)) return;
              if (trimmed === '0' && !stopComment.trim()) return;
              confirmStopTimer();
            }}
          />
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
              {qtyCompleted === '0'
                ? <>Reason <span className="text-red-500 text-xs">(required — qty is 0)</span></>
                : <>Comment <span className="text-gray-400 text-xs">(optional)</span></>}
            </label>
            <textarea
              value={stopComment}
              onChange={(e) => setStopComment(e.target.value)}
              placeholder={qtyCompleted === '0'
                ? 'Explain why no units were completed (e.g. waiting on parts, machine down, training)'
                : 'Add a note about this work...'}
              rows={2}
              className={`w-full px-4 py-2 border-2 rounded-lg text-sm focus:ring-2 focus:outline-none transition-all dark:bg-slate-700 dark:text-white resize-none ${
                qtyCompleted === '0' && !stopComment.trim()
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                  : 'border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-200'
              }`}
            />
            {qtyCompleted === '0' && !stopComment.trim() && (
              <p className="text-xs text-red-600 font-medium mt-1">An explanation is required when the quantity is 0.</p>
            )}
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              onClick={() => {
                setIsQtyModalOpen(false);
                setPendingStopEntryId(null);
                setQtyCompleted('');
                setStopComment('');
              }}
              className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmStopTimer}
              disabled={
                isStopping
                || qtyCompleted.trim() === ''
                || !/^\d+$/.test(qtyCompleted.trim())
                || (qtyCompleted === '0' && !stopComment.trim())
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {isStopping ? 'Stopping...' : 'Stop Timer'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Manual Entry Modal (ADMIN only) */}
      <Modal
        size="lg"
        isOpen={isManualEntryOpen}
        onClose={() => {
          setIsManualEntryOpen(false);
          setManualEntryData({
            job_number: '',
            job_display: '',
            traveler_id: undefined,
            work_center: '',
            step_id: undefined,
            operator_name: '',
            operator_id: undefined,
            start_time: '',
            end_time: '',
            comment: '',
            qty_completed: '',
            pauses: [],
          });
          setManualJobWorkCenterOptions([]);
        }}
        title="Manual Labor Entry (Admin Only)"
        footer={
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => {
                setIsManualEntryOpen(false);
                setManualEntryData({
                  job_number: '',
                  job_display: '',
                  traveler_id: undefined,
                  work_center: '',
                  step_id: undefined,
                  operator_name: '',
                  operator_id: undefined,
                  start_time: '',
                  end_time: '',
                  comment: '',
                  qty_completed: '',
                  pauses: [],
                });
                setManualJobWorkCenterOptions([]);
              }}
              className="px-6 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 font-semibold rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleManualEntry}
              className="px-6 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all shadow-md"
            >
              Create Completed Entry
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Job Number <span className="text-red-500">*</span>
              </label>
              <Autocomplete
                value={manualEntryData.job_display || manualEntryData.job_number}
                onChange={(value) => {
                  // Typing invalidates any pinned traveler; keep the label in
                  // job_display and the real number in job_number.
                  setManualEntryData({ ...manualEntryData, job_number: extractJobNumber(value), job_display: value, traveler_id: undefined });
                  if (!value) {
                    setManualJobWorkCenterOptions([]);
                  }
                }}
                onSelect={async (option: any) => {
                  const jobNum = (option.job_number || extractJobNumber(option.value || '')).trim();
                  if (!jobNum) return;
                  // Pin the picked traveler so an RMA and the job it reworks
                  // (same job_number) resolve to their OWN work centers.
                  const pickedTravelerId =
                    typeof option.traveler_id === 'number' ? option.traveler_id :
                    typeof option.id === 'number' ? option.id : undefined;
                  setManualEntryData(prev => ({ ...prev, job_number: jobNum, job_display: option.job_display || option.value || jobNum, traveler_id: pickedTravelerId, work_center: '', step_id: undefined }));
                  const steps = await fetchWorkCentersByJob(jobNum, '', pickedTravelerId);
                  setManualJobWorkCenterOptions(steps);
                }}
                fetchSuggestions={fetchJobNumbers}
                placeholder="Type job number or search..."
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                required
                minChars={0}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Work Center <span className="text-red-500">*</span>
              </label>
              <Autocomplete
                value={manualEntryData.work_center}
                onChange={(value) => setManualEntryData({ ...manualEntryData, work_center: value, step_id: undefined })}
                onSelect={(option: any) => {
                  setManualEntryData(prev => ({ ...prev, work_center: option.value || option.label, step_id: option.step_id }));
                }}
                fetchSuggestions={async (query) => {
                  if (manualEntryData.job_number) {
                    const jobSteps = await fetchWorkCentersByJob(manualEntryData.job_number, query, manualEntryData.traveler_id, manualEntryData.job_display);
                    if (jobSteps.length > 0) {
                      const generalWCs = await fetchWorkCenters(query);
                      const existingValues = new Set(jobSteps.map((f: any) => f.value));
                      return [...jobSteps, ...generalWCs.filter((wc: any) => !existingValues.has(wc.value))];
                    }
                  }
                  return fetchWorkCenters(query);
                }}
                placeholder="Select from steps or type/scan..."
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                required
                minChars={0}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Operator Name <span className="text-red-500">*</span>
            </label>
            <Autocomplete
              value={manualEntryData.operator_name}
              onChange={(value) => setManualEntryData({ ...manualEntryData, operator_name: value, operator_id: undefined })}
              onSelect={(option) => setManualEntryData({ ...manualEntryData, operator_name: option.value, operator_id: option.id })}
              fetchSuggestions={fetchOperators}
              placeholder="Select operator from list..."
              className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
              required
              minChars={0}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={manualEntryData.start_time}
                onChange={(e) => setManualEntryData({ ...manualEntryData, start_time: e.target.value })}
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={manualEntryData.end_time}
                onChange={(e) => setManualEntryData({ ...manualEntryData, end_time: e.target.value })}
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Qty Completed <span className="text-gray-400 text-xs">(optional)</span>
            </label>
            <input
              type="number"
              min="0"
              value={manualEntryData.qty_completed}
              onChange={(e) => setManualEntryData({ ...manualEntryData, qty_completed: e.target.value })}
              placeholder="Enter quantity..."
              className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
            />
          </div>

          {/* Pauses Section */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Pauses <span className="text-gray-400 text-xs">(optional)</span>
            </label>
            {manualEntryData.pauses.length > 0 && (
              <div className="space-y-2 mb-3">
                {manualEntryData.pauses.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm">
                    <span className="text-gray-500 font-mono text-xs">#{idx + 1}</span>
                    <span className="text-gray-700 dark:text-slate-300">{p.paused_at} → {p.resumed_at}</span>
                    {p.comment && <span className="text-gray-500 text-xs truncate">({p.comment})</span>}
                    <button onClick={() => setManualEntryData(prev => ({ ...prev, pauses: prev.pauses.filter((_, i) => i !== idx) }))} className="ml-auto text-red-500 hover:text-red-700 text-xs font-bold">Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="datetime-local" id="manual-pause-start" placeholder="Pause start" className="px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200" />
              <input type="datetime-local" id="manual-pause-end" placeholder="Pause end" className="px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200" />
              <div className="flex gap-2">
                <input type="text" id="manual-pause-comment" placeholder="Comment (opt)" className="flex-1 px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200" />
                <button
                  type="button"
                  onClick={() => {
                    const startEl = document.getElementById('manual-pause-start') as HTMLInputElement;
                    const endEl = document.getElementById('manual-pause-end') as HTMLInputElement;
                    const commentEl = document.getElementById('manual-pause-comment') as HTMLInputElement;
                    if (!startEl?.value || !endEl?.value) { toast.error('Fill pause start and end'); return; }
                    setManualEntryData(prev => ({
                      ...prev,
                      pauses: [...prev.pauses, { paused_at: startEl.value, resumed_at: endEl.value, comment: commentEl?.value || '' }]
                    }));
                    startEl.value = ''; endEl.value = ''; if (commentEl) commentEl.value = '';
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold whitespace-nowrap"
                >+ Add</button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              {manualEntryData.qty_completed === '0'
                ? <>Reason <span className="text-red-500 text-xs">(required — qty is 0)</span></>
                : <>Comment <span className="text-gray-400 text-xs">(optional)</span></>}
            </label>
            <textarea
              value={manualEntryData.comment}
              onChange={(e) => setManualEntryData({ ...manualEntryData, comment: e.target.value })}
              placeholder={manualEntryData.qty_completed === '0'
                ? 'Explain why no units were completed'
                : 'Add a note about this work...'}
              rows={2}
              className={`w-full px-4 py-2 border-2 rounded-lg text-sm focus:ring-2 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200 resize-none ${
                manualEntryData.qty_completed === '0' && !(manualEntryData.comment && manualEntryData.comment.trim())
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                  : 'border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-200'
              }`}
            />
          </div>
        </div>
      </Modal>

      {/* Edit Entry Modal (ADMIN only) */}
      <Modal
        size="lg"
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Labor Entry"
        footer={
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setIsEditModalOpen(false)}
              className="px-6 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 font-semibold rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleEditEntry}
              className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all shadow-md"
            >
              Save Changes
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Job Number
              </label>
              <input
                type="text"
                value={editEntryData.job_number}
                disabled
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-gray-100 dark:bg-slate-700 cursor-not-allowed text-gray-600 dark:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Work Center <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editEntryData.work_center}
                onChange={(e) => setEditEntryData({ ...editEntryData, work_center: e.target.value })}
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Operator Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={editEntryData.operator_name}
              onChange={(e) => setEditEntryData({ ...editEntryData, operator_name: e.target.value })}
              className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={convertISOToLocal(editEntryData.start_time)}
                onChange={(e) => setEditEntryData({ ...editEntryData, start_time: convertLocalToISO(e.target.value) })}
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={convertISOToLocal(editEntryData.end_time)}
                onChange={(e) => setEditEntryData({ ...editEntryData, end_time: convertLocalToISO(e.target.value) })}
                className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Qty Completed <span className="text-gray-400 text-xs">(optional)</span>
            </label>
            <input
              type="number"
              min="0"
              value={editEntryData.qty_completed}
              onChange={(e) => setEditEntryData({ ...editEntryData, qty_completed: e.target.value })}
              placeholder="Enter quantity..."
              className="w-full px-4 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200"
            />
          </div>

          {/* Existing Pauses */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Pauses {editEntryData.pause_logs.length > 0 && <span className="text-amber-600 text-xs">({editEntryData.pause_logs.length} total)</span>}
            </label>
            {editEntryData.pause_logs.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {editEntryData.pause_logs.map((pl, idx) => (
                  <div key={pl.id} className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm">
                    <span className="text-gray-500 font-mono text-xs">#{idx + 1}</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">{pl.duration_seconds ? formatSecondsCompact(pl.duration_seconds) : 'active'}</span>
                    <span className="text-gray-500 dark:text-slate-400 text-xs">
                      {new Date(pl.paused_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })}
                      {pl.resumed_at && ` → ${new Date(pl.resumed_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                    {pl.comment && <span className="text-gray-400 text-xs truncate">({pl.comment})</span>}
                    <button onClick={() => deletePauseFromEditEntry(pl.id)} className="ml-auto text-red-500 hover:text-red-700 text-xs font-bold" title="Remove pause">X</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="datetime-local"
                value={editEntryData.newPause.paused_at}
                onChange={(e) => setEditEntryData(prev => ({ ...prev, newPause: { ...prev.newPause, paused_at: e.target.value } }))}
                className="px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200"
                placeholder="Pause start"
              />
              <input
                type="datetime-local"
                value={editEntryData.newPause.resumed_at}
                onChange={(e) => setEditEntryData(prev => ({ ...prev, newPause: { ...prev.newPause, resumed_at: e.target.value } }))}
                className="px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200"
                placeholder="Pause end"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editEntryData.newPause.comment}
                  onChange={(e) => setEditEntryData(prev => ({ ...prev, newPause: { ...prev.newPause, comment: e.target.value } }))}
                  placeholder="Comment (opt)"
                  className="flex-1 px-3 py-1.5 border-2 border-gray-300 dark:border-slate-600 rounded-lg text-sm focus:border-amber-500 focus:outline-none dark:bg-slate-700 dark:text-slate-200"
                />
                <button type="button" onClick={addPauseToEditEntry} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold whitespace-nowrap">+ Add</button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              {editEntryData.qty_completed === '0'
                ? <>Reason <span className="text-red-500 text-xs">(required — qty is 0)</span></>
                : <>Comment <span className="text-gray-400 text-xs">(optional)</span></>}
            </label>
            <textarea
              value={editEntryData.comment}
              onChange={(e) => setEditEntryData({ ...editEntryData, comment: e.target.value })}
              placeholder={editEntryData.qty_completed === '0' ? 'Explain why qty is 0' : 'Add or edit comment...'}
              rows={2}
              className={`w-full px-4 py-2 border-2 rounded-lg text-sm focus:ring-2 focus:outline-none transition-all dark:bg-slate-700 dark:text-slate-200 resize-none ${
                editEntryData.qty_completed === '0' && !(editEntryData.comment && editEntryData.comment.trim())
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                  : 'border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-200'
              }`}
            />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
