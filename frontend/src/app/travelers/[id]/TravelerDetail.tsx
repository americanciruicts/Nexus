'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, Suspense } from 'react';
import Layout from '@/components/layout/Layout';
import { ArrowLeftIcon, PrinterIcon, CheckIcon, XMarkIcon, PlusIcon, TrashIcon, PencilIcon, Bars3Icon, DocumentTextIcon, CpuChipIcon, WrenchScrewdriverIcon, BoltIcon, ShoppingCartIcon, ArrowPathIcon, ArrowsRightLeftIcon, WrenchIcon } from '@heroicons/react/24/outline';
import { getWorkCentersByType, WorkCenterItem, DEPARTMENT_BAR_COLORS, DEPARTMENT_COLORS, isRmaType } from '@/data/workCenters';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import { TravelerType } from '@/types';
import TravelerFlowBar from '@/components/TravelerFlowBar';
import TravelerGroupBadge from '@/components/TravelerGroupBadge';
import JobDocuments from './JobDocuments';
import CommunicationLogSection from './CommunicationLog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Helper function to format YYYY-MM-DD to MM/DD/YYYY without timezone conversion
const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return '';
  // Check if already in MM/DD/YYYY format
  if (dateStr.includes('/')) return dateStr;

  // Parse YYYY-MM-DD format
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${month}/${day}/${year}`;
  }
  return dateStr;
};

interface ProcessStep {
  id?: number;
  seq: number;
  workCenter: string;
  instruction: string;
  quantity: number | string;
  accepted: number | string;
  rejected: number | string;
  sign: string;
  completedDate: string;
  completedTime?: string;
  status: string;
  assignee: string;
  // Rolled up from labor entries by the backend (read-only, never saved back).
  laborSigners?: string[];
  laborTotalHours?: number | null;
  laborLatestDate?: string | null;
}

// Labor hours as the floor reads them: a 10-minute step should say "10 min",
// not "0.16". Under an hour reads in whole minutes; an hour or more reads as
// hours plus any remaining minutes ("2h 15m", or plain "2h" when it lands even).
function formatLaborTime(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes <= 0) return '0 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// US date for the sign-off column, matching the MM/DD/YYYY the header dates
// already use. The API sends ISO (YYYY-MM-DD) so it stays sortable; anything not
// ISO is a hand-typed value and is left exactly as entered.
function formatSignoffDate(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : dateStr;
}

// The traveler's sign-off columns read from recorded labor whenever any exists;
// the hand-typed value is only a fallback for steps nobody has clocked against.
function signoffOf(step: ProcessStep) {
  return {
    sign: step.laborSigners?.length ? step.laborSigners.join(', ') : (step.sign || ''),
    time: step.laborTotalHours != null ? formatLaborTime(step.laborTotalHours) : (step.completedTime || ''),
    date: formatSignoffDate(step.laborLatestDate || step.completedDate || ''),
  };
}

interface Specification {
  id: string;
  text: string;
  date: string;
}

interface LaborEntry {
  id: string;
  workCenter: string;
  operatorName: string;
  startTime: string;
  endTime: string;
  totalHours: string;
}

interface RmaUnit {
  id?: number;
  unit_number: number;
  serial_number: string;
  customer_complaint: string;
  incoming_inspection_notes: string;
  disposition: string;
  troubleshooting_notes: string;
  repairing_notes: string;
  final_inspection_notes: string;
  customer_ncr?: string;
  original_po_number?: string;
  original_wo_number?: string;
  customer_revision_sent?: string;
  customer_revision_received?: string;
  original_built_quantity?: number;
  units_shipped?: number;
  custom_values?: Record<string, string>;
}

type RmaTableColumn = {
  key: string;
  label: string;
  type: 'standard' | 'custom';
  // Relative print/display width in px (used as a proportion under table-layout:
  // fixed). User-adjustable in edit mode; persisted so print reflects the choice.
  width?: number;
};

// Default/clamp values for adjustable Unit Serial Number Tracking columns.
const RMA_COL_DEFAULT_WIDTH = 140;
const RMA_COL_MIN_WIDTH = 70;
const RMA_COL_MAX_WIDTH = 360;
const RMA_COL_WIDTH_STEP = 20;

// Card wording for each traveler type, reused wherever a type is shown to the
// user (create cards, job-lookup picker) so an RMA always reads the same way.
const TRAVELER_TYPE_LINES: Record<string, { name: string; line: string }> = {
  PCB_ASSEMBLY: { name: 'PCB Assembly', line: 'Full board assembly with components' },
  PCB: { name: 'PCB', line: 'Bare circuit board fabrication' },
  CABLE: { name: 'Cable Assembly', line: 'Cable and wire harness assembly' },
  PURCHASING: { name: 'Purchasing', line: 'Parts and components procurement' },
  RMA_SAME: { name: 'RMA Router Same Job', line: 'RMA from same job or revision, PO or work order' },
  RMA_DIFF: { name: 'RMA Router Diff Job', line: 'RMA from different jobs or revisions, POs or work orders' },
  MODIFICATION: { name: 'Modification and Rework', line: 'Board modification and rework' },
};

// Shape returned by /travelers/by-job-number/... — a traveler to auto-fill from
interface LookupTraveler {
  id?: number;
  job_number: string;
  work_order_number?: string;
  po_number?: string;
  traveler_type?: string;
  part_number?: string;
  part_description?: string;
  revision?: string;
  customer_revision?: string;
  part_revision?: string;
  quantity?: number;
  customer_code?: string;
  customer_name?: string;
  priority?: string;
  status?: string;
  work_center?: string;
  specs?: unknown;
  from_stock?: string;
  to_stock?: string;
  ship_via?: string;
  comments?: string;
  due_date?: string;
  ship_date?: string;
  include_labor_hours?: boolean;
  process_steps?: Record<string, unknown>[];
}

interface Traveler {
  id: string;
  travelerId: number;
  jobNumber: string;
  workOrder: string;
  poNumber?: string;
  partNumber: string;
  description: string;
  revision: string;
  customerRevision?: string;
  partRevision?: string;
  quantity: number;
  customerCode: string;
  customerName: string;
  status: string;
  createdAt: string;
  dueDate: string;
  shipDate: string;
  specs: Specification[];
  fromStock: string;
  toStock: string;
  shipVia: string;
  comments: string;
  steps: ProcessStep[];
  laborEntries: LaborEntry[];
  travelerType: string;
  isActive: boolean;
  includeLaborHours: boolean;
  priority: string;
  // RMA-specific fields
  rmaNumber?: string;
  customerContact?: string;
  originalWoNumber?: string;
  originalPoNumber?: string;
  returnPoNumber?: string;
  rmaPoNumber?: string;
  invoiceNumber?: string;
  customerNcr?: string;
  originalBuiltQuantity?: number;
  unitsShipped?: number;
  quantityRmaIssued?: number;
  unitsReceived?: number;
  customerRevisionSent?: string;
  customerRevisionReceived?: string;
  rmaNotes?: string;
  woTypeLabel?: string;
  rmaTableColumns?: RmaTableColumn[];
  rmaUnits?: RmaUnit[];
  // Group linking fields
  groupId?: number | null;
  groupSequence?: number | null;
  groupLabel?: string | null;
  groupInfo?: {
    groupId: number;
    groupName?: string;
    currentSequence: number;
    totalCount: number;
    members: Array<{
      id: number;
      jobNumber: string;
      travelerType: string;
      groupSequence: number;
      groupLabel?: string;
      quantity: number;
      status: string;
      workOrderNumber?: string;
    }>;
  } | null;
}

// Default columns for the Unit Serial Number Tracking table. Standard columns
// map to fields on RmaUnit; custom columns store their value in custom_values.
const DEFAULT_RMA_TABLE_COLUMNS: RmaTableColumn[] = [
  { key: 'serial_number',             label: 'Unit Serial Number',              type: 'standard' },
  { key: 'customer_complaint',        label: 'Customer Complaint',              type: 'standard' },
  { key: 'incoming_inspection_notes', label: 'Incoming Inspection Result/Note', type: 'standard' },
  { key: 'disposition',               label: 'Disposition of Unit',             type: 'standard' },
  { key: 'troubleshooting_notes',     label: 'Troubleshooting/Testing Notes',   type: 'standard' },
  { key: 'repairing_notes',           label: 'Repairing Notes',                 type: 'standard' },
  { key: 'final_inspection_notes',    label: 'Final Inspection Notes',          type: 'standard' },
];

const STANDARD_RMA_KEYS = new Set(DEFAULT_RMA_TABLE_COLUMNS.map(c => c.key));

// Sortable table row wrapper for drag-and-drop in desktop view
function SortableTableRow({ id, children }: { id: string; children: (props: { dragHandleProps: Record<string, unknown>; style: React.CSSProperties; ref: (node: HTMLElement | null) => void }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 50 : 'auto',
  };
  return <>{children({ dragHandleProps: { ...attributes, ...listeners }, style, ref: setNodeRef })}</>;
}

// Sortable card wrapper for drag-and-drop in mobile view
function SortableMobileCard({ id, children }: { id: string; children: (props: { dragHandleProps: Record<string, unknown>; style: React.CSSProperties; ref: (node: HTMLElement | null) => void }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 50 : 'auto',
  };
  return <>{children({ dragHandleProps: { ...attributes, ...listeners }, style, ref: setNodeRef })}</>;
}


export function TravelerDetailPage({ createMode = false }: { createMode?: boolean } = {}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const travelerId = createMode ? '' : (params?.id as string || '');
  const autoEdit = searchParams?.get('edit') === 'true';

  // Create mode state
  const [selectedType, setSelectedType] = useState<TravelerType | ''>('');
  const [showForm, setShowForm] = useState(!createMode);
  const [workOrderPrefix, setWorkOrderPrefix] = useState('');
  const [workOrderSuffix, setWorkOrderSuffix] = useState('');
  const [isGeneratingWO, setIsGeneratingWO] = useState(false);
  const [isLeadFree, setIsLeadFree] = useState(false);
  const [isITAR, setIsITAR] = useState(false);
  const [includeLaborHours, setIncludeLaborHours] = useState(true);
  // Job lookup can resolve to several travelers (e.g. a PCBA build and an RMA
  // on the same job) — let the user pick which one to duplicate from.
  const [existingWorkOrders, setExistingWorkOrders] = useState<LookupTraveler[]>([]);
  const [showWorkOrderSelector, setShowWorkOrderSelector] = useState(false);

  const [traveler, setTraveler] = useState<Traveler | null>(null);
  const [loadError, setLoadError] = useState<'auth' | 'notfound' | null>(null);
  const [isLoading, setIsLoading] = useState(!createMode);
  const [isEditing, setIsEditing] = useState(createMode);
  const [editedTraveler, setEditedTraveler] = useState<Traveler | null>(null);
  const [stepQRCodes, setStepQRCodes] = useState<Record<number, string>>({});
  const [headerBarcode, setHeaderBarcode] = useState<string>('');
  // Readiness is driven by the <img onLoad> of each code, not by fetch completion.
  // Empty/failed fetches cannot flip these to true, so Print stays disabled until
  // pixels actually render. Prevents the "print a page with missing barcode" bug.
  const [headerBarcodeRendered, setHeaderBarcodeRendered] = useState(false);
  const [stepQRCodesRenderedCount, setStepQRCodesRenderedCount] = useState(0);
  const [stepQRCodesFetchDone, setStepQRCodesFetchDone] = useState(false);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const headerBarcodeRenderedRef = useRef(false);
  const stepQRCodesRenderedCountRef = useRef(0);
  const stepQRCodesFetchDoneRef = useRef(false);
  const renderedStepIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => { headerBarcodeRenderedRef.current = headerBarcodeRendered; }, [headerBarcodeRendered]);
  useEffect(() => { stepQRCodesRenderedCountRef.current = stepQRCodesRenderedCount; }, [stepQRCodesRenderedCount]);
  useEffect(() => { stepQRCodesFetchDoneRef.current = stepQRCodesFetchDone; }, [stepQRCodesFetchDone]);

  // Reset the rendered tracker whenever the barcode src or QR map changes
  // (e.g. when the traveler is reloaded or refreshed). Otherwise stale "rendered"
  // state from a previous traveler would falsely unblock Print.
  useEffect(() => {
    if (!headerBarcode) setHeaderBarcodeRendered(false);
  }, [headerBarcode]);
  useEffect(() => {
    renderedStepIdsRef.current = new Set();
    setStepQRCodesRenderedCount(0);
  }, [stepQRCodes]);

  const handleHeaderBarcodeLoad = () => {
    if (!headerBarcodeRenderedRef.current) setHeaderBarcodeRendered(true);
  };
  const handleStepQRLoad = (stepId: number) => {
    if (renderedStepIdsRef.current.has(stepId)) return;
    renderedStepIdsRef.current.add(stepId);
    setStepQRCodesRenderedCount(c => c + 1);
  };

  // DOM reconciler — base64 images often hit the browser cache and fire load
  // before React attaches the onLoad listener (or never re-fire on subsequent
  // renders), leaving Print stuck on "Loading…" even when every QR is on
  // screen. After each barcode/QR state update, scan the DOM and mark any
  // image that's already complete + has natural pixels. Polls a few times
  // to catch images that decode async.
  useEffect(() => {
    let cancelled = false;
    const reconcile = () => {
      if (cancelled) return;
      const headerImgs = document.querySelectorAll<HTMLImageElement>('img[data-print-img="header-barcode"]');
      for (const img of Array.from(headerImgs)) {
        if (img.complete && img.naturalWidth > 0) {
          handleHeaderBarcodeLoad();
          break;
        }
      }
      const stepImgs = document.querySelectorAll<HTMLImageElement>('img[data-print-img="step-qr"]');
      for (const img of Array.from(stepImgs)) {
        const sid = Number(img.getAttribute('data-step-id'));
        if (!Number.isFinite(sid) || sid <= 0) continue;
        if (img.complete && img.naturalWidth > 0) {
          handleStepQRLoad(sid);
        }
      }
    };
    // Sweep across a few frames to catch sync-cached + async-decoded loads.
    const ids: number[] = [];
    [0, 50, 200, 500, 1000, 2000].forEach(delay => {
      ids.push(window.setTimeout(reconcile, delay));
    });
    return () => {
      cancelled = true;
      ids.forEach(id => window.clearTimeout(id));
    };
  }, [headerBarcode, stepQRCodes]);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [shortageInfo, setShortageInfo] = useState<{ short: number; total_components: number; percent: number } | null>(null);

  // Track auto-filled values to require at least one change before saving
  const [autoFilledFrom, setAutoFilledFrom] = useState<{
    workOrder: string;
    revision: string;
    customerRevision: string;
  } | null>(null);

  // Dynamic work centers from DB
  const [dynamicWorkCenters, setDynamicWorkCenters] = useState<WorkCenterItem[]>([]);

  // Department progress state
  interface DeptStep {
    id: number;
    step_number: number;
    operation: string;
    is_completed: boolean;
    labor_hours?: number;
    has_labor?: boolean;
  }
  interface DeptProgress {
    department: string;
    total_steps: number;
    completed_steps: number;
    percent_complete: number;
    labor_hours?: number;
    steps_with_labor?: number;
    labor_percent?: number;
    steps?: DeptStep[];
  }
  interface LaborOverall {
    total_hours: number;
    entries_count: number;
    active_entries: number;
    steps_with_labor: number;
    total_steps: number;
    percent: number;
  }
  const [departmentProgress, setDepartmentProgress] = useState<DeptProgress[]>([]);
  // Bumped after a step-completion override so the card refetches its numbers.
  const [deptRefreshKey, setDeptRefreshKey] = useState(0);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [savingStepId, setSavingStepId] = useState<number | null>(null);
  const [overallProgress, setOverallProgress] = useState({ total_steps: 0, completed_steps: 0, percent_complete: 0 });
  const [laborOverall, setLaborOverall] = useState<LaborOverall>({ total_hours: 0, entries_count: 0, active_entries: 0, steps_with_labor: 0, total_steps: 0, percent: 0 });
  const [categoryHours, setCategoryHours] = useState<Record<string, number>>({});
  const [lastLoggedStep, setLastLoggedStep] = useState<{ work_center: string; operators: string[]; hours_worked: number; end_time: string } | null>(null);

  // Refs for step rows to enable auto-scroll after reordering
  const stepRowRefs = useRef<{ [key: number]: HTMLTableRowElement | null }>({});
  const suffixInputRef = useRef<HTMLInputElement | null>(null);
  const suffixInputRef2 = useRef<HTMLInputElement | null>(null);
  // Focus whichever suffix input is visible
  const focusSuffixInput = (cursorPos: number) => {
    requestAnimationFrame(() => {
      // Try the desktop ref first, then mobile, then RMA
      const refs = [suffixInputRef2, suffixInputRef];
      for (const ref of refs) {
        if (ref.current && ref.current.offsetParent !== null) {
          ref.current.focus();
          ref.current.setSelectionRange(cursorPos, cursorPos);
          return;
        }
      }
      // Fallback: just try the first one
      if (suffixInputRef.current) {
        suffixInputRef.current.focus();
        suffixInputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };
  // Debounce timer for step sequence reordering
  const seqReorderTimeout = useRef<NodeJS.Timeout | null>(null);

  // Drag and drop sensors
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!editedTraveler) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = editedTraveler.steps.findIndex(s => String(s.id ?? s.seq) === String(active.id));
    const newIndex = editedTraveler.steps.findIndex(s => String(s.id ?? s.seq) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove([...editedTraveler.steps], oldIndex, newIndex);
    const renumbered = reordered.map((step, idx) => ({ ...step, seq: idx + 1 }));
    setEditedTraveler({ ...editedTraveler, steps: renumbered });
  };

  // Keep page at top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Fetch dynamic work centers when traveler type is known
  useEffect(() => {
    const typeToUse = createMode ? selectedType : traveler?.travelerType;
    if (!typeToUse) return;
    const typeMap: Record<string, string> = { 'PCB_ASSEMBLY': 'PCB_ASSEMBLY', 'PCB': 'PCB', 'CABLE': 'CABLE', 'CABLES': 'CABLE', 'ASSY': 'PCB_ASSEMBLY', 'PURCHASING': 'PURCHASING', 'RMA_SAME': 'RMA_SAME', 'RMA_DIFF': 'RMA_DIFF', 'MODIFICATION': 'MODIFICATION' };
    const dbType = typeMap[typeToUse] || 'PCB_ASSEMBLY';
    const fetchWC = async () => {
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/?traveler_type=${dbType}`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.length > 0) {
            setDynamicWorkCenters(data.map((wc: Record<string, string>) => ({ name: wc.name, description: wc.description || '', code: wc.code || '' })));
            return;
          }
        }
      } catch { /* fallback */ }
      setDynamicWorkCenters(getWorkCentersByType(typeToUse));
    };
    fetchWC();
  }, [traveler?.travelerType, createMode, selectedType]);

  // Load traveler from API
  useEffect(() => {
    const fetchTraveler = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/travelers/${travelerId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          // Parse specs - if it's a string, convert to array
          let specsArray: Specification[] = [];
          if (data.specs) {
            if (typeof data.specs === 'string') {
              try {
                const parsed = JSON.parse(data.specs);
                if (Array.isArray(parsed)) {
                  specsArray = parsed;
                } else {
                  specsArray = [{ id: '1', text: data.specs, date: String(data.specs_date || '') }];
                }
              } catch {
                specsArray = [{ id: '1', text: data.specs, date: String(data.specs_date || '') }];
              }
            } else if (Array.isArray(data.specs)) {
              specsArray = data.specs;
            }
          }

          const formattedTraveler = {
            id: String(data.job_number),
            travelerId: Number(data.id),
            jobNumber: String(data.job_number),
            workOrder: String(data.work_order_number || ''),
            poNumber: String(data.po_number || ''),
            partNumber: String(data.part_number),
            description: String(data.part_description),
            revision: String(data.revision),
            customerRevision: String(data.customer_revision || ''),
            partRevision: String(data.part_revision || ''),
            quantity: Number(data.quantity),
            customerCode: String(data.customer_code || ''),
            customerName: String(data.customer_name || ''),
            status: String(data.status),
            createdAt: String(data.start_date || data.created_at || '').split('T')[0],
            dueDate: String(data.due_date || '').split('T')[0],
            shipDate: String(data.ship_date || '').split('T')[0],
            specs: specsArray,
            fromStock: String(data.from_stock || ''),
            toStock: String(data.to_stock || ''),
            shipVia: String(data.ship_via || ''),
            comments: String(data.comments || ''),
            travelerType: String(data.traveler_type || 'PCB_ASSEMBLY'),
            isActive: Boolean(data.is_active),
            includeLaborHours: Boolean(data.include_labor_hours),
            priority: String(data.priority || 'NORMAL'),
            steps: (data.process_steps || []).map((step: Record<string, unknown>) => ({
              id: Number(step.id),
              seq: Number(step.step_number),
              workCenter: String(step.operation),
              instruction: String(step.instructions || ''),
              quantity: step.quantity || '',
              accepted: step.accepted || '',
              rejected: step.rejected || '',
              sign: String(step.sign || ''),
              completedDate: String(step.completed_date || ''),
              completedTime: String(step.completed_time || ''),
              laborSigners: (step.labor_signers as string[]) || [],
              laborTotalHours: step.labor_total_hours as number | null,
              laborLatestDate: (step.labor_latest_date as string | null) || null,
              status: step.is_completed ? 'COMPLETED' : 'PENDING',
              assignee: ''
            })).sort((a: ProcessStep, b: ProcessStep) => Number(a.seq) - Number(b.seq)),
            laborEntries: Array.from({ length: 20 }, (_, i) => ({
              id: String(i + 1),
              workCenter: '',
              operatorName: '',
              startTime: '',
              endTime: '',
              totalHours: ''
            })),
            // RMA-specific fields
            rmaNumber: String(data.rma_number || ''),
            customerContact: String(data.customer_contact || ''),
            originalWoNumber: String(data.original_wo_number || ''),
            originalPoNumber: String(data.original_po_number || ''),
            returnPoNumber: String(data.return_po_number || ''),
            rmaPoNumber: String(data.rma_po_number || ''),
            invoiceNumber: String(data.invoice_number || ''),
            customerNcr: String(data.customer_ncr || ''),
            originalBuiltQuantity: data.original_built_quantity || undefined,
            unitsShipped: data.units_shipped || undefined,
            quantityRmaIssued: data.quantity_rma_issued || undefined,
            unitsReceived: data.units_received || undefined,
            customerRevisionSent: String(data.customer_revision_sent || ''),
            customerRevisionReceived: String(data.customer_revision_received || ''),
            rmaNotes: String(data.rma_notes || ''),
            woTypeLabel: String(data.wo_type_label || ''),
            rmaTableColumns: (() => {
              try {
                return data.rma_table_columns ? JSON.parse(data.rma_table_columns as string) as RmaTableColumn[] : undefined;
              } catch { return undefined; }
            })(),
            rmaUnits: (data.rma_units || []).length > 0
              ? ((data.rma_units as Record<string, unknown>[]).map(u => ({
                  ...(u as unknown as RmaUnit),
                  custom_values: (() => {
                    try {
                      return u.custom_values ? JSON.parse(u.custom_values as string) as Record<string, string> : {};
                    } catch { return {}; }
                  })(),
                })).sort((a, b) => (Number(a.unit_number) || 0) - (Number(b.unit_number) || 0)))
              : Array.from({ length: 5 }, (_, i) => ({
                  unit_number: i + 1, serial_number: '', customer_complaint: '',
                  incoming_inspection_notes: '', disposition: '',
                  troubleshooting_notes: '', repairing_notes: '', final_inspection_notes: '',
                  custom_values: {},
                })),
            // Group linking fields
            groupId: data.group_id || null,
            groupSequence: data.group_sequence || null,
            groupLabel: data.group_label || null,
            groupInfo: data.group_info ? {
              groupId: data.group_info.group_id,
              groupName: data.group_info.group_name,
              currentSequence: data.group_info.current_sequence,
              totalCount: data.group_info.total_count,
              members: (data.group_info.members || []).map((m: Record<string, unknown>) => ({
                id: Number(m.id),
                jobNumber: String(m.job_number),
                travelerType: String(m.traveler_type),
                groupSequence: Number(m.group_sequence),
                groupLabel: m.group_label ? String(m.group_label) : undefined,
                quantity: Number(m.quantity),
                status: String(m.status),
                workOrderNumber: m.work_order_number ? String(m.work_order_number) : undefined,
              })),
            } : null,
          };
          setTraveler(formattedTraveler);
          setEditedTraveler(formattedTraveler);

          // Fetch QR codes for all steps
          fetchStepQRCodes(Number(data.id));

          // Fetch header barcode
          fetchHeaderBarcode(Number(data.id));

          // Fetch department progress
          fetchDepartmentProgress(Number(data.id));

          // Fetch last logged labor step (real entries, not the printable form rows)
          fetchLastLoggedStep(Number(data.id));

          // Fetch shortage info for this job
          try {
            const shortageRes = await fetch(`${API_BASE_URL}/jobs/${encodeURIComponent(data.job_number)}/kitting-status`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}` }
            });
            if (shortageRes.ok) {
              const ks = await shortageRes.json();
              if (ks.short > 0) {
                setShortageInfo({ short: ks.short, total_components: ks.total_components, percent: ks.percent });
              }
            }
          } catch { /* non-critical */ }
        } else if (response.status === 401) {
          // Not a missing traveler — a dead session. Saying "not found" here
          // sent operators hunting for a data problem that didn't exist.
          setLoadError('auth');
        } else {
          console.error('Failed to fetch traveler');
          setLoadError('notfound');
        }
      } catch (error) {
        console.error('Error fetching traveler:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchHeaderBarcode = async (travelerDbId: number) => {
      // Readiness is flipped only when a usable image arrives AND the <img> tag
      // fires onLoad. An empty/failed response must NOT unblock Print — the old
      // finally-based toggle let users print a page with no barcode rendered.
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`${API_BASE_URL}/barcodes/traveler/${travelerDbId}`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        });
        if (!response.ok) {
          console.error('❌ Header barcode fetch failed, status:', response.status);
          return;
        }
        const data = await response.json();
        if (!data.barcode_image) {
          console.error('❌ Header barcode endpoint returned empty image');
          return;
        }
        setHeaderBarcode(data.barcode_image);
      } catch (error) {
        console.error('❌ Error fetching header barcode:', error);
      }
    };

    const fetchDepartmentProgress = async (travelerDbId: number) => {
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`${API_BASE_URL}/travelers/department-progress/${travelerDbId}`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        });
        if (response.ok) {
          const data = await response.json();
          setDepartmentProgress(data.departments || []);
          setOverallProgress(data.overall || { total_steps: 0, completed_steps: 0, percent_complete: 0 });
          setLaborOverall(data.labor || { total_hours: 0, entries_count: 0, active_entries: 0, steps_with_labor: 0, total_steps: 0, percent: 0 });
          setCategoryHours(data.category_hours || {});
        }
      } catch (error) {
        console.error('Error fetching department progress:', error);
      }
    };

    const fetchLastLoggedStep = async (travelerDbId: number) => {
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`${API_BASE_URL}/labor/traveler/${travelerDbId}`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        });
        if (!response.ok) return;
        const entries: Array<{ step_id: number | null; work_center: string | null; employee_name: string; hours_worked: number; end_time: string | null }> = await response.json();
        const completed = entries
          .filter(e => e.end_time && e.work_center)
          .sort((a, b) => new Date(b.end_time as string).getTime() - new Date(a.end_time as string).getTime());
        const last = completed[0];
        if (last) {
          // A single step can be worked by 2-3 operators (each logs their own
          // labor entry). Gather every operator + their hours for the LAST step
          // so the summary shows all names, not just whoever closed it last.
          const sameStep = completed.filter(e =>
            last.step_id != null ? e.step_id === last.step_id : e.work_center === last.work_center
          );
          const operators = Array.from(new Set(sameStep.map(e => (e.employee_name || '').trim()).filter(Boolean)));
          const totalHours = sameStep.reduce((sum, e) => sum + (e.hours_worked || 0), 0);
          setLastLoggedStep({
            work_center: last.work_center as string,
            operators,
            hours_worked: totalHours,
            end_time: last.end_time as string,
          });
        } else {
          setLastLoggedStep(null);
        }
      } catch (error) {
        console.error('Error fetching last logged step:', error);
      }
    };

    const fetchStepQRCodes = async (travelerDbId: number) => {
      // Same intent as fetchHeaderBarcode: the state map is the *source of truth*
      // for expected images. Print readiness then waits for each <img onLoad>.
      try {
        const response = await fetch(`${API_BASE_URL}/barcodes/traveler/${travelerDbId}/steps-qr`);
        if (response.ok) {
          const data = await response.json();
          const qrCodeMap: Record<number, string> = {};
          (data.process_steps || []).forEach((s: {step_id: number; qr_code_image: string}) => {
            if (s.qr_code_image) qrCodeMap[s.step_id] = s.qr_code_image;
          });
          (data.manual_steps || []).forEach((s: {step_id: number; qr_code_image: string}) => {
            if (s.qr_code_image) qrCodeMap[s.step_id] = s.qr_code_image;
          });
          setStepQRCodes(qrCodeMap);
          setStepQRCodesFetchDone(true);
          return;
        }
        setTimeout(async () => {
          try {
            const retryRes = await fetch(`${API_BASE_URL}/barcodes/traveler/${travelerDbId}/steps-qr`);
            if (retryRes.ok) {
              const data = await retryRes.json();
              const qrMap: Record<number, string> = {};
              (data.process_steps || []).forEach((s: {step_id: number; qr_code_image: string}) => {
                if (s.qr_code_image) qrMap[s.step_id] = s.qr_code_image;
              });
              (data.manual_steps || []).forEach((s: {step_id: number; qr_code_image: string}) => {
                if (s.qr_code_image) qrMap[s.step_id] = s.qr_code_image;
              });
              setStepQRCodes(qrMap);
            }
          } catch { /* silent retry */ } finally {
            setStepQRCodesFetchDone(true);
          }
        }, 2000);
      } catch (error) {
        console.error('Error fetching QR codes:', error);
        setStepQRCodesFetchDone(true);
      }
    };

    if (travelerId && !createMode) {
      fetchTraveler();
    }
  }, [travelerId, createMode, deptRefreshKey]);

  // Auto-refresh traveler data every 3 minutes (silent — no loading spinner)
  // Reduced from 60s to cut API load. QR codes rarely change.
  useEffect(() => {
    if (!travelerId || createMode) return;
    const pollInterval = setInterval(() => {
      const token = localStorage.getItem('nexus_token');
      fetch(`${API_BASE_URL}/travelers/${travelerId}`, {
        headers: { 'Authorization': `Bearer ${token || ''}` }
      }).then(res => {
        if (res.ok) return res.json();
      }).then(data => {
        if (!data) return;
        fetch(`${API_BASE_URL}/barcodes/traveler/${data.id}/steps-qr`, {
          headers: { 'Authorization': `Bearer ${token || ''}` }
        }).then(r => r.ok ? r.json() : null).then(qrData => {
          if (qrData?.process_steps) {
            const qrMap: Record<number, string> = {};
            qrData.process_steps.forEach((s: {step_id: number; qr_code_image: string}) => {
              if (s.qr_code_image) qrMap[s.step_id] = s.qr_code_image;
            });
            if (qrData.manual_steps) {
              qrData.manual_steps.forEach((s: {step_id: number; qr_code_image: string}) => {
                if (s.qr_code_image) qrMap[s.step_id] = s.qr_code_image;
              });
            }
            setStepQRCodes(qrMap);
          }
        }).catch(() => {});
      }).catch(() => {});
    }, 180000);
    return () => clearInterval(pollInterval);
  }, [travelerId, createMode]);

  // Auto-enter edit mode when ?edit=true is in URL, then clean the URL
  useEffect(() => {
    if (autoEdit && traveler && !isEditing) {
      handleEdit();
      // Remove ?edit=true from URL so back button doesn't re-enter edit mode
      window.history.replaceState({}, '', `/travelers/${travelerId}`);
    }
  }, [autoEdit, traveler]);

  // Intercept Ctrl+P / Cmd+P so the keyboard shortcut can't bypass the
  // disabled Print button while barcodes are still loading. Without this,
  // users who hit the shortcut mid-fetch ended up printing a 2-page preview
  // with missing barcodes.
  useEffect(() => {
    if (createMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        handlePrint();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // handlePrint is stable enough via closures over refs; we don't need it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode]);

  const isAdminUser = user?.role === 'ADMIN';

  // Admin override for a step nobody clocked. The backend is the authority on
  // permission (403s non-admins) and on what the numbers become, so this just
  // posts the change and refetches rather than adjusting counts locally — the
  // same step can sit in two departments (VERIFY BOM is Engineering AND Prep),
  // and guessing the new totals client-side would get those wrong.
  const toggleStepCompletion = async (stepId: number, next: boolean) => {
    if (!isAdminUser || !traveler?.travelerId) return;
    setSavingStepId(stepId);
    try {
      const token = localStorage.getItem('nexus_token');
      const res = await fetch(`${API_BASE_URL}/travelers/${traveler.travelerId}/steps/${stepId}/completion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token || ''}` },
        body: JSON.stringify({ is_completed: next }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        toast.error(detail?.detail || 'Could not update step');
        return;
      }
      const body = await res.json().catch(() => ({}));
      setDeptRefreshKey(k => k + 1);
      if (body?.status_changed) {
        // Shipping moves the whole traveler, so say so rather than letting the
        // status change happen silently behind a generic "step updated".
        toast.success(`Shipping updated — traveler is now ${body.status_changed.split('-> ')[1]}`);
      } else {
        toast.success(next ? 'Step marked complete' : 'Step marked incomplete');
      }
    } catch {
      toast.error('Could not update step');
    } finally {
      setSavingStepId(null);
    }
  };

  // Print is only safe once barcodes have finished fetching. Clicking before
  // barcode state lands caused pages to render without barcodes (see Alex's
  // missing-barcode reports). We also await each <img>.decode() to guarantee
  // the browser has rasterized every base64 barcode before window.print().
  const expectedStepQRCount = Object.keys(stepQRCodes).length;
  const stepQRCodesAllRendered = stepQRCodesFetchDone && stepQRCodesRenderedCount >= expectedStepQRCount;
  // A traveler is only print-ready once every barcode/QR <img> has fired onLoad.
  // Header: rendered flag. Steps: rendered count ≥ expected count (post-fetch).
  // If header barcode fetch fails outright, src stays '' and onLoad never fires,
  // so print remains blocked — which is what we want.
  const isPrintReady = !isLoading && headerBarcodeRendered && stepQRCodesAllRendered;

  const handlePrint = async () => {
    if (isPreparingPrint) return;
    setIsPreparingPrint(true);
    try {
      toast.dismiss();

      if (!isPrintReady) {
        const toastId = toast.loading('Preparing barcodes for print…');
        const start = Date.now();
        while (
          (!headerBarcodeRenderedRef.current
            || !stepQRCodesFetchDoneRef.current
            || stepQRCodesRenderedCountRef.current < Object.keys(stepQRCodes).length) &&
          Date.now() - start < 20000
        ) {
          await new Promise(r => setTimeout(r, 150));
        }
        toast.dismiss(toastId);

        // If readiness still didn't land, abort instead of printing a
        // half-rendered traveler. Users were getting 2-page previews with
        // missing barcodes because we used to proceed regardless.
        const stillMissingHeader = !headerBarcodeRenderedRef.current;
        const stillMissingSteps =
          !stepQRCodesFetchDoneRef.current ||
          stepQRCodesRenderedCountRef.current < Object.keys(stepQRCodes).length;
        if (stillMissingHeader || stillMissingSteps) {
          toast.error('Barcodes are still loading. Please wait a moment and try Print again.');
          return;
        }
      }

      // Wait for every barcode/QR <img> in the DOM to finish decoding.
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
      await Promise.all(
        images.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          if (typeof img.decode === 'function') {
            return img.decode().catch(() => {});
          }
          return new Promise<void>(resolve => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          });
        })
      );

      const wasDark = document.documentElement.classList.contains('dark');
      if (wasDark) {
        document.documentElement.classList.remove('dark');
      }
      window.addEventListener('afterprint', () => {
        if (wasDark) document.documentElement.classList.add('dark');
      }, { once: true });

      // Let the browser flush the dark-mode style change before print dialog.
      await new Promise(r => setTimeout(r, 150));
      window.print();
    } finally {
      setIsPreparingPrint(false);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    // Deep copy traveler including all nested arrays
    setEditedTraveler(traveler ? {
      ...traveler,
      steps: traveler.steps.map(step => ({ ...step })),
      specs: traveler.specs.map(spec => ({ ...spec })),
      laborEntries: traveler.laborEntries.map(entry => ({ ...entry }))
    } : null);
    // Split work order into prefix-suffix for edit mode
    if (traveler?.workOrder) {
      const parts = traveler.workOrder.split('-');
      if (parts.length >= 2) {
        setWorkOrderPrefix(parts[0]);
        setWorkOrderSuffix(parts.slice(1).join('-'));
      } else {
        setWorkOrderPrefix(traveler.workOrder);
        setWorkOrderSuffix('');
      }
    }
    // Prevent page from scrolling when entering edit mode
    window.scrollTo(0, 0);
  };

  const handleCancel = () => {
    if (createMode) {
      router.push('/travelers');
      return;
    }
    setIsEditing(false);
    setEditedTraveler(traveler);
    // Keep page at top when cancelling edit
    window.scrollTo(0, 0);
  };

  const handleSave = async () => {
    if (!editedTraveler) return;

    try {
      const payload = {
        job_number: editedTraveler.jobNumber,
        rma_number: editedTraveler.rmaNumber || '',
        work_order_number: editedTraveler.workOrder,
        po_number: editedTraveler.poNumber || '',
        part_number: editedTraveler.partNumber,
        part_description: editedTraveler.description,
        revision: editedTraveler.revision,
        customer_revision: editedTraveler.customerRevision || '',
        part_revision: editedTraveler.partRevision || '',
        quantity: Number(editedTraveler.quantity) || 0,
        customer_code: editedTraveler.customerCode || '',
        customer_name: editedTraveler.customerName || '',
        start_date: editedTraveler.createdAt || '',
        due_date: editedTraveler.dueDate || '',
        ship_date: editedTraveler.shipDate || '',
        specs: typeof editedTraveler.specs === 'string' ? editedTraveler.specs : JSON.stringify(editedTraveler.specs),
        specs_date: editedTraveler.specs.length > 0 ? editedTraveler.specs[editedTraveler.specs.length - 1].date : '',
        from_stock: editedTraveler.fromStock || '',
        to_stock: editedTraveler.toStock || '',
        ship_via: editedTraveler.shipVia || '',
        comments: editedTraveler.comments || '',
        is_active: editedTraveler.isActive !== undefined ? editedTraveler.isActive : true,
        include_labor_hours: editedTraveler.includeLaborHours !== undefined ? editedTraveler.includeLaborHours : false,
        traveler_type: editedTraveler.travelerType || 'PCB_ASSEMBLY',
        priority: editedTraveler.priority || 'NORMAL',
        work_center: editedTraveler.steps.length > 0 ? (editedTraveler.steps[0].workCenter || 'ASSEMBLY') : 'ASSEMBLY',
        notes: '',
        process_steps: editedTraveler.steps.map(step => ({
          step_number: Number(step.seq) || 0,
          operation: step.workCenter || '',
          work_center_code: dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.code || (step.workCenter || '').replace(/\s+/g, '_').toUpperCase() || 'UNKNOWN',
          instructions: step.instruction || '',
          estimated_time: 30,
          is_required: true,
          quantity: step.quantity ? Number(step.quantity) : null,
          accepted: step.accepted ? Number(step.accepted) : null,
          rejected: step.rejected ? Number(step.rejected) : null,
          sign: step.sign || null,
          completed_date: step.completedDate || null,
          completed_time: step.completedTime || null,
          sub_steps: []
        })),
        manual_steps: [],
        // The RMA header block. Create and Save-as-draft always sent these, but
        // the edit-mode PUT only sent rma_number — so changing "Quantity RMA
        // issued for" (or any other header field) and saving silently dropped
        // the new value and the old one came back on reload.
        ...(isRmaType(editedTraveler.travelerType || '') ? {
          customer_contact: editedTraveler.customerContact || '',
          original_wo_number: editedTraveler.originalWoNumber || '',
          original_po_number: editedTraveler.originalPoNumber || '',
          return_po_number: editedTraveler.returnPoNumber || '',
          rma_po_number: editedTraveler.rmaPoNumber || '',
          invoice_number: editedTraveler.invoiceNumber || '',
          customer_ncr: editedTraveler.customerNcr || '',
          original_built_quantity: editedTraveler.originalBuiltQuantity || null,
          units_shipped: editedTraveler.unitsShipped || null,
          quantity_rma_issued: editedTraveler.quantityRmaIssued || null,
          units_received: editedTraveler.unitsReceived || null,
          customer_revision_sent: editedTraveler.customerRevisionSent || '',
          customer_revision_received: editedTraveler.customerRevisionReceived || '',
          rma_notes: editedTraveler.rmaNotes || '',
        } : {}),
        wo_type_label: editedTraveler.travelerType === 'MODIFICATION' ? (editedTraveler.woTypeLabel || 'Modification') : null,
        rma_table_columns: editedTraveler.rmaTableColumns ? JSON.stringify(editedTraveler.rmaTableColumns) : null,
        rma_units: (editedTraveler.rmaUnits || []).filter(u => u.serial_number || u.customer_complaint || (u.custom_values && Object.values(u.custom_values).some(v => v))).map(u => ({
          unit_number: u.unit_number,
          serial_number: u.serial_number || '',
          customer_complaint: u.customer_complaint || '',
          incoming_inspection_notes: u.incoming_inspection_notes || '',
          disposition: u.disposition || '',
          troubleshooting_notes: u.troubleshooting_notes || '',
          repairing_notes: u.repairing_notes || '',
          final_inspection_notes: u.final_inspection_notes || '',
          customer_ncr: u.customer_ncr || '',
          original_po_number: u.original_po_number || '',
          original_wo_number: u.original_wo_number || '',
          customer_revision_sent: u.customer_revision_sent || '',
          customer_revision_received: u.customer_revision_received || '',
          original_built_quantity: u.original_built_quantity || null,
          units_shipped: u.units_shipped || null,
          custom_values: u.custom_values && Object.keys(u.custom_values).length > 0 ? JSON.stringify(u.custom_values) : null,
        })),
      };

      console.log('Sending update payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(`${API_BASE_URL}/travelers/${editedTraveler.travelerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response body:', responseText);

      if (response.ok) {
        toast.success('Traveler updated successfully!');
        // Full reload to get fresh step IDs + QR codes immediately
        window.location.href = `/travelers/${travelerId}`;
        return;
      } else {
        let errorMessage = 'Failed to update traveler';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.detail || errorMessage;
        } catch {
          errorMessage = responseText || errorMessage;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error updating traveler:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Error updating traveler: ${errorMessage}. Check the console for more details.`);
    }
  };

  const updateField = (field: keyof Traveler, value: string | number) => {
    if (!editedTraveler) return;
    setEditedTraveler({ ...editedTraveler, [field]: value });
  };

  const updateStep = (index: number, field: keyof ProcessStep, value: string | number) => {
    if (!editedTraveler) return;
    const newSteps = [...editedTraveler.steps];
    newSteps[index] = { ...newSteps[index], [field]: value };

    // If sequence number changed, debounce the reorder (wait 3s for user to finish typing)
    if (field === 'seq') {
      // Update the value immediately so user sees what they typed
      setEditedTraveler({ ...editedTraveler, steps: newSteps });

      // Clear any pending reorder
      if (seqReorderTimeout.current) {
        clearTimeout(seqReorderTimeout.current);
      }

      // Store the step id so we can find it after state updates
      const movingStepId = editedTraveler.steps[index]?.id;

      // Reorder after 3 seconds of no changes
      seqReorderTimeout.current = setTimeout(() => {
        setEditedTraveler(prev => {
          if (!prev) return prev;
          const targetSequence = Number(value);

          // Find the step by its unique id (index may have shifted)
          const movingStepIndex = movingStepId
            ? prev.steps.findIndex(s => s.id === movingStepId)
            : index;
          const movingStep = prev.steps[movingStepIndex];
          if (!movingStep) return prev;

          // Remove the moving step from the array
          const otherSteps = prev.steps.filter((_, i) => i !== movingStepIndex);

          // Insert at the target position (clamped to valid range)
          const insertAt = Math.max(0, Math.min(targetSequence - 1, otherSteps.length));
          const reorderedSteps = [
            ...otherSteps.slice(0, insertAt),
            movingStep,
            ...otherSteps.slice(insertAt)
          ];

          // Renumber ALL steps consecutively (1, 2, 3, ...)
          const renumberedSteps = reorderedSteps.map((step, idx) => ({
            ...step,
            seq: idx + 1
          }));

          // Scroll to the moved step at its new position
          setTimeout(() => {
            const stepElement = stepRowRefs.current[insertAt];
            if (stepElement) {
              stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              stepElement.style.backgroundColor = '#dbeafe';
              setTimeout(() => {
                stepElement.style.backgroundColor = '';
              }, 1500);
            }
          }, 100);

          return { ...prev, steps: renumberedSteps };
        });
      }, 3000);
    } else {
      setEditedTraveler({ ...editedTraveler, steps: newSteps });
    }
  };

  const addStep = () => {
    if (!editedTraveler) return;
    const newStep: ProcessStep = {
      seq: editedTraveler.steps.length + 1,
      workCenter: '',
      instruction: '',
      quantity: '',
      accepted: '',
      rejected: '',
      sign: '',
      completedDate: '',
      status: 'PENDING',
      assignee: ''
    };
    setEditedTraveler({ ...editedTraveler, steps: [...editedTraveler.steps, newStep] });
  };

  const removeStep = (index: number) => {
    if (!editedTraveler) return;
    const newSteps = editedTraveler.steps.filter((_, i) => i !== index);

    // Renumber remaining steps consecutively
    const renumberedSteps = newSteps.map((step, idx) => ({
      ...step,
      seq: idx + 1
    }));

    setEditedTraveler({ ...editedTraveler, steps: renumberedSteps });
  };

  // RMA Unit Tracking helpers
  const updateRmaUnit = (index: number, field: keyof RmaUnit, value: string | number) => {
    if (!editedTraveler || !editedTraveler.rmaUnits) return;
    const newUnits = [...editedTraveler.rmaUnits];
    newUnits[index] = { ...newUnits[index], [field]: value };
    setEditedTraveler({ ...editedTraveler, rmaUnits: newUnits });
  };

  const addRmaUnit = () => {
    if (!editedTraveler) return;
    const units = editedTraveler.rmaUnits || [];
    const newUnit: RmaUnit = {
      // max + 1, not length + 1 — blank rows are dropped on save, so the count
      // and the highest No. drift apart and length+1 would duplicate a number.
      unit_number: units.reduce((max, u) => Math.max(max, Number(u.unit_number) || 0), 0) + 1,
      serial_number: '',
      customer_complaint: '',
      incoming_inspection_notes: '',
      disposition: '',
      troubleshooting_notes: '',
      repairing_notes: '',
      final_inspection_notes: '',
    };
    setEditedTraveler({ ...editedTraveler, rmaUnits: [...units, newUnit] });
  };

  const removeRmaUnit = (index: number) => {
    if (!editedTraveler || !editedTraveler.rmaUnits) return;
    const newUnits = editedTraveler.rmaUnits.filter((_, i) => i !== index);
    const renumbered = newUnits.map((u, i) => ({ ...u, unit_number: i + 1 }));
    setEditedTraveler({ ...editedTraveler, rmaUnits: renumbered });
  };

  // Update the value of a custom column for one unit.
  const updateRmaUnitCustom = (index: number, columnKey: string, value: string) => {
    if (!editedTraveler || !editedTraveler.rmaUnits) return;
    const newUnits = [...editedTraveler.rmaUnits];
    const current = newUnits[index].custom_values || {};
    newUnits[index] = { ...newUnits[index], custom_values: { ...current, [columnKey]: value } };
    setEditedTraveler({ ...editedTraveler, rmaUnits: newUnits });
  };

  const addRmaTableColumn = () => {
    if (!editedTraveler) return;
    const current = editedTraveler.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS;
    const existingKeys = new Set(current.map(c => c.key));
    let i = 1;
    while (existingKeys.has(`custom_${i}`)) i++;
    const newCol: RmaTableColumn = { key: `custom_${i}`, label: 'New Column', type: 'custom' };
    setEditedTraveler({ ...editedTraveler, rmaTableColumns: [...current, newCol] });
  };

  const renameRmaTableColumn = (key: string, label: string) => {
    if (!editedTraveler) return;
    const current = editedTraveler.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS;
    const next = current.map(c => c.key === key ? { ...c, label } : c);
    setEditedTraveler({ ...editedTraveler, rmaTableColumns: next });
  };

  // Set a Unit Serial Number Tracking column to an absolute width (clamped).
  // Uses a functional update so rapid drag-resize moves don't race on stale state.
  const setRmaTableColumnWidth = (key: string, width: number) => {
    const w = Math.max(RMA_COL_MIN_WIDTH, Math.min(RMA_COL_MAX_WIDTH, Math.round(width)));
    setEditedTraveler(prev => {
      if (!prev) return prev;
      const current = prev.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS;
      return { ...prev, rmaTableColumns: current.map(c => c.key === key ? { ...c, width: w } : c) };
    });
  };

  // Grow/shrink a column by a fixed step (− / + buttons).
  const resizeRmaTableColumn = (key: string, delta: number) => {
    const cols = editedTraveler?.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS;
    const cur = cols.find(c => c.key === key)?.width || RMA_COL_DEFAULT_WIDTH;
    setRmaTableColumnWidth(key, cur + delta);
  };

  // Drag the divider on a column's right edge to resize it live.
  const startColResize = (e: React.MouseEvent, col: RmaTableColumn) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width || RMA_COL_DEFAULT_WIDTH;
    const onMove = (ev: MouseEvent) => setRmaTableColumnWidth(col.key, startW + (ev.clientX - startX));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const removeRmaTableColumn = (key: string) => {
    if (!editedTraveler) return;
    const current = editedTraveler.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS;
    if (current.length <= 1) {
      window.alert('At least one column must remain.');
      return;
    }
    const col = current.find(c => c.key === key);
    if (!col) return;
    if (!window.confirm(`Delete column "${col.label}" and all of its data?`)) return;
    const remaining = current.filter(c => c.key !== key);
    // Wipe the column's data on every unit so no orphan values are persisted.
    const newUnits = (editedTraveler.rmaUnits || []).map(u => {
      if (col.type === 'custom') {
        const { [key]: _removed, ...rest } = u.custom_values || {};
        void _removed;
        return { ...u, custom_values: rest };
      }
      return { ...u, [key]: '' };
    });
    setEditedTraveler({ ...editedTraveler, rmaTableColumns: remaining, rmaUnits: newUnits });
  };

  const addSpecification = () => {
    if (!editedTraveler) return;
    const newSpec: Specification = {
      id: Date.now().toString(),
      text: '',
      date: new Date().toISOString().split('T')[0]
    };
    setEditedTraveler({ ...editedTraveler, specs: [...editedTraveler.specs, newSpec] });
  };

  const updateSpecification = (id: string, field: 'text' | 'date', value: string) => {
    if (!editedTraveler) return;
    const newSpecs = editedTraveler.specs.map(spec =>
      spec.id === id ? { ...spec, [field]: value } : spec
    );
    setEditedTraveler({ ...editedTraveler, specs: newSpecs });
  };

  const removeSpecification = (id: string) => {
    if (!editedTraveler) return;
    const newSpecs = editedTraveler.specs.filter(spec => spec.id !== id);
    setEditedTraveler({ ...editedTraveler, specs: newSpecs });
  };

  const updateLaborEntry = (id: string, field: keyof LaborEntry, value: string) => {
    if (!editedTraveler) return;
    const newLaborEntries = editedTraveler.laborEntries.map(entry =>
      entry.id === id ? { ...entry, [field]: value } : entry
    );
    setEditedTraveler({ ...editedTraveler, laborEntries: newLaborEntries });
  };

  // ---- Create Mode Logic ----

  // Allocate the next sequential WO number from the backend and seed the
  // prefix input. Shared by the create-mode auto-populate and the manual
  // Generate button shown in edit mode so users can refresh the number
  // without re-entering the whole traveler.
  const generateWorkOrder = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    try {
      if (!silent) setIsGeneratingWO(true);
      const response = await fetch(`${API_BASE_URL}/travelers/next-work-order-number`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.next_work_order_prefix) {
          setWorkOrderPrefix(data.next_work_order_prefix);
          setWorkOrderSuffix('');
          updateField('workOrder', data.next_work_order_prefix);
          if (!silent) toast.success(`Generated WO ${data.next_work_order_prefix}`);
          return data.next_work_order_prefix as string;
        }
      }
      if (!silent) toast.error('Failed to generate next work order number');
    } catch (error) {
      console.error('Failed to fetch next work order number:', error);
      if (!silent) toast.error('Failed to generate next work order number');
    } finally {
      if (!silent) setIsGeneratingWO(false);
    }
    return null;
  };

  // When an Original WO Number is entered on an RMA traveler, look up the
  // original (non-RMA) traveler for that work order and auto-fill the original
  // job's details into the RMA. No-op when the WO isn't found in the system.
  const autofillFromOriginalWo = async (wo: string) => {
    const trimmed = (wo || '').trim();
    if (!trimmed || !isRmaType(editedTraveler?.travelerType || '')) return;
    try {
      const response = await fetch(`${API_BASE_URL}/travelers/original-by-work-order/${encodeURIComponent(trimmed)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data) {
        toast.error(`No original traveler found for WO ${trimmed}`);
        return;
      }
      setEditedTraveler(prev => prev ? {
        ...prev,
        partNumber: data.part_number || prev.partNumber,
        description: data.part_description || prev.description,
        revision: data.revision || prev.revision,
        customerRevision: data.customer_revision || prev.customerRevision,
        partRevision: data.part_revision || prev.partRevision,
        customerCode: data.customer_code || prev.customerCode,
        customerName: data.customer_name || prev.customerName,
        originalPoNumber: data.po_number || prev.originalPoNumber,
        originalBuiltQuantity: (data.quantity ?? prev.originalBuiltQuantity),
      } : prev);
      toast.success(`Filled details from original WO ${trimmed}${data.job_number ? ` (job ${data.job_number})` : ''}`);
    } catch (error) {
      console.error('Failed to fetch original traveler by work order:', error);
    }
  };

  // Fetch next work order number in create mode
  useEffect(() => {
    if (!createMode) return;
    generateWorkOrder({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMode]);

  // Default an RMA traveler's "Issued on" date to today whenever it hasn't been
  // set yet (new traveler or a draft saved without one). Only fills when empty,
  // so an already-entered issue date is never overwritten.
  useEffect(() => {
    if (!isEditing || !isRmaType(editedTraveler?.travelerType || '')) return;
    if (editedTraveler && !editedTraveler.createdAt) {
      setEditedTraveler(prev => prev && !prev.createdAt
        ? { ...prev, createdAt: new Date().toISOString().split('T')[0] }
        : prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, editedTraveler?.travelerType, editedTraveler?.createdAt]);

  const travelerTypes = [
    { value: 'PCB_ASSEMBLY', label: 'PCB Assembly', description: 'Full board assembly with components', subtitle: 'SMT, Through-Hole, Inspection, Testing', gradient: 'from-teal-600 to-emerald-700', borderColor: 'border-blue-400', iconBg: 'bg-white/20', bubbleColor: 'bg-blue-400/20', icon: CpuChipIcon },
    { value: 'PCB', label: 'PCB', description: 'Bare circuit board fabrication', subtitle: 'Etching, Drilling, Plating, Solder Mask', gradient: 'from-emerald-600 to-green-700', borderColor: 'border-green-400', iconBg: 'bg-white/20', bubbleColor: 'bg-green-400/20', icon: WrenchScrewdriverIcon },
    { value: 'CABLE', label: 'Cable Assembly', description: 'Cable and wire harness assembly', subtitle: 'Cutting, Stripping, Crimping, Testing', gradient: 'from-purple-600 to-violet-700', borderColor: 'border-purple-400', iconBg: 'bg-white/20', bubbleColor: 'bg-purple-400/20', icon: BoltIcon },
    { value: 'PURCHASING', label: 'Purchasing', description: 'Parts and components procurement', subtitle: 'Sourcing, Receiving, QC Inspection', gradient: 'from-orange-500 to-amber-700', borderColor: 'border-orange-400', iconBg: 'bg-white/20', bubbleColor: 'bg-orange-400/20', icon: ShoppingCartIcon },
    { value: 'RMA_SAME', label: 'RMA Router Same Job', description: 'RMA from same job or revision, PO or work order', subtitle: 'Inspection, Repair, Testing, Shipping', gradient: 'from-red-600 to-rose-700', borderColor: 'border-red-400', iconBg: 'bg-white/20', bubbleColor: 'bg-red-400/20', icon: ArrowPathIcon },
    { value: 'RMA_DIFF', label: 'RMA Router Diff Job', description: 'RMA from different jobs or revisions, POs or work orders', subtitle: 'Multi-Job Tracking, Repair, Testing', gradient: 'from-pink-600 to-fuchsia-700', borderColor: 'border-pink-400', iconBg: 'bg-white/20', bubbleColor: 'bg-pink-400/20', icon: ArrowsRightLeftIcon },
    { value: 'MODIFICATION', label: 'Modification and Rework', description: 'Board modification and rework', subtitle: 'Modification, Testing, Inspection', gradient: 'from-amber-600 to-yellow-700', borderColor: 'border-amber-400', iconBg: 'bg-white/20', bubbleColor: 'bg-amber-400/20', icon: WrenchIcon },
  ];

  const handleTypeSelect = (type: TravelerType) => {
    setSelectedType(type);
    // Create empty traveler with default steps for this type
    const workCenters = getWorkCentersByType(type);
    const defaultSteps: ProcessStep[] = workCenters.map((wc, index) => ({
      seq: index + 1,
      workCenter: wc.name,
      instruction: '',
      quantity: '',
      accepted: '',
      rejected: '',
      sign: '',
      completedDate: '',
      status: 'PENDING',
      assignee: ''
    }));

    const today = new Date().toISOString().split('T')[0];
    const isRma = isRmaType(type);
    const emptyTraveler: Traveler = {
      id: '',
      travelerId: 0,
      jobNumber: '',
      workOrder: workOrderPrefix || '',
      poNumber: '',
      partNumber: '',
      description: '',
      revision: 'A',
      customerRevision: '',
      partRevision: '',
      quantity: 0,
      customerCode: '',
      customerName: '',
      status: 'CREATED',
      createdAt: today,
      dueDate: '',
      shipDate: '',
      specs: [],
      fromStock: '',
      toStock: '',
      shipVia: '',
      comments: '',
      steps: defaultSteps,
      laborEntries: Array.from({ length: 20 }, (_, i) => ({
        id: String(i + 1),
        workCenter: '',
        operatorName: '',
        startTime: '',
        endTime: '',
        totalHours: ''
      })),
      travelerType: type,
      isActive: true,
      includeLaborHours: type !== 'PCB' && !isRma,
      priority: 'NORMAL',
      // RMA-specific defaults
      ...(isRma ? {
        rmaNumber: '',
        customerContact: '',
        originalWoNumber: '',
        originalPoNumber: '',
        returnPoNumber: 'N/A',
        rmaPoNumber: 'N/A',
        invoiceNumber: 'N/A',
        customerNcr: 'N/A',
        originalBuiltQuantity: undefined,
        unitsShipped: undefined,
        quantityRmaIssued: undefined,
        unitsReceived: undefined,
        customerRevisionSent: '',
        customerRevisionReceived: '',
        rmaNotes: '',
        woTypeLabel: type === 'MODIFICATION' ? 'Modification' : '',
        rmaTableColumns: undefined,
        rmaUnits: Array.from({ length: 5 }, (_, i) => ({
          unit_number: i + 1,
          serial_number: '',
          customer_complaint: '',
          incoming_inspection_notes: i === 0 ? 'No other visual defects found.' : '',
          disposition: i === 0 ? 'Troubleshoot, repair and test.' : '',
          troubleshooting_notes: '',
          repairing_notes: '',
          final_inspection_notes: '',
        })),
      } : {}),
    };

    setEditedTraveler(emptyTraveler);
    setTraveler(emptyTraveler);
    setShowForm(true);
    setIncludeLaborHours(type !== 'PCB');
  };

  const handleCreate = async () => {
    if (!editedTraveler) return;
    if (!editedTraveler.jobNumber) {
      toast.warning('Please enter a Job Number');
      return;
    }

    // If auto-filled from existing traveler, require at least one key field to be changed
    if (autoFilledFrom) {
      // Build current work order for comparison
      let currentWorkOrder = '';
      if (workOrderPrefix && workOrderSuffix) {
        currentWorkOrder = `${workOrderPrefix}-${workOrderSuffix}`;
      } else if (workOrderPrefix) {
        currentWorkOrder = workOrderPrefix;
      } else {
        currentWorkOrder = editedTraveler.workOrder || '';
      }

      const woChanged = currentWorkOrder !== autoFilledFrom.workOrder;
      const revChanged = editedTraveler.revision !== autoFilledFrom.revision;
      const custRevChanged = (editedTraveler.customerRevision || '') !== autoFilledFrom.customerRevision;

      if (!woChanged && !revChanged && !custRevChanged) {
        toast.warning('This traveler was auto-filled from an existing one. You must change at least one of: Work Order, BOM Rev, or Customer Rev before saving.');
        return;
      }
    }

    let fullJobNumber = editedTraveler.jobNumber;
    if (isLeadFree) fullJobNumber += 'L';
    if (isITAR) fullJobNumber += 'M';

    // Build work order from prefix + suffix
    let fullWorkOrder = '';
    if (workOrderPrefix && workOrderSuffix) {
      fullWorkOrder = `${workOrderPrefix}-${workOrderSuffix}`;
    } else if (workOrderPrefix) {
      fullWorkOrder = workOrderPrefix;
    } else {
      fullWorkOrder = editedTraveler.workOrder || fullJobNumber;
    }

    const travelerData = {
      job_number: fullJobNumber,
      work_order_number: fullWorkOrder,
      po_number: editedTraveler.poNumber || '',
      traveler_type: selectedType || 'PCB_ASSEMBLY',
      part_number: editedTraveler.partNumber || '',
      part_description: editedTraveler.description || 'Assembly',
      revision: editedTraveler.revision || 'A',
      customer_revision: editedTraveler.customerRevision || '',
      part_revision: editedTraveler.partRevision || '',
      quantity: Number(editedTraveler.quantity) || 1,
      customer_code: editedTraveler.customerCode || '',
      customer_name: editedTraveler.customerName || '',
      priority: editedTraveler.priority || 'NORMAL',
      work_center: editedTraveler.steps.length > 0 ? editedTraveler.steps[0].workCenter || 'ASSEMBLY' : 'ASSEMBLY',
      status: 'CREATED',
      is_active: true,
      // Honor the checkbox the user toggled in the form (editedTraveler.includeLaborHours).
      // The local `includeLaborHours` state is only set at type-select time and never
      // updated by the form checkbox, so reading it here loses the user's uncheck —
      // which then forced them to go into edit mode to clear labor hours.
      include_labor_hours: editedTraveler.includeLaborHours ?? includeLaborHours,
      notes: '',
      specs: JSON.stringify(editedTraveler.specs),
      specs_date: editedTraveler.specs.length > 0 ? editedTraveler.specs[editedTraveler.specs.length - 1].date : '',
      from_stock: editedTraveler.fromStock || '',
      to_stock: editedTraveler.toStock || '',
      ship_via: editedTraveler.shipVia || '',
      comments: editedTraveler.comments || '',
      start_date: editedTraveler.createdAt || '',
      due_date: editedTraveler.dueDate || '',
      ship_date: editedTraveler.shipDate || editedTraveler.dueDate || '',
      process_steps: editedTraveler.steps.map(step => ({
        step_number: Number(step.seq) || 0,
        operation: step.workCenter || '',
        work_center_code: dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.code || (step.workCenter || '').replace(/\s+/g, '_').toUpperCase() || 'UNKNOWN',
        instructions: step.instruction || '',
        estimated_time: 30,
        is_required: true,
        quantity: step.quantity ? Number(step.quantity) : null,
        accepted: step.accepted ? Number(step.accepted) : null,
        rejected: step.rejected ? Number(step.rejected) : null,
        sign: step.sign || null,
        completed_date: step.completedDate || null,
        completed_time: step.completedTime || null,
        sub_steps: []
      })),
      manual_steps: [],
      // RMA-specific fields
      ...(isRmaType(selectedType || '') ? {
        rma_number: editedTraveler.rmaNumber || '',
        customer_contact: editedTraveler.customerContact || '',
        original_wo_number: editedTraveler.originalWoNumber || '',
        original_po_number: editedTraveler.originalPoNumber || '',
        return_po_number: editedTraveler.returnPoNumber || '',
        rma_po_number: editedTraveler.rmaPoNumber || '',
        invoice_number: editedTraveler.invoiceNumber || '',
        customer_ncr: editedTraveler.customerNcr || '',
        original_built_quantity: editedTraveler.originalBuiltQuantity || null,
        units_shipped: editedTraveler.unitsShipped || null,
        quantity_rma_issued: editedTraveler.quantityRmaIssued || null,
        units_received: editedTraveler.unitsReceived || null,
        customer_revision_sent: editedTraveler.customerRevisionSent || '',
        customer_revision_received: editedTraveler.customerRevisionReceived || '',
        rma_notes: editedTraveler.rmaNotes || '',
        wo_type_label: editedTraveler.travelerType === 'MODIFICATION' ? (editedTraveler.woTypeLabel || 'Modification') : null,
        rma_table_columns: editedTraveler.rmaTableColumns ? JSON.stringify(editedTraveler.rmaTableColumns) : null,
        rma_units: (editedTraveler.rmaUnits || []).filter(u => u.serial_number || u.customer_complaint || (u.custom_values && Object.values(u.custom_values).some(v => v))).map(u => ({
          unit_number: u.unit_number,
          serial_number: u.serial_number || '',
          customer_complaint: u.customer_complaint || '',
          incoming_inspection_notes: u.incoming_inspection_notes || '',
          disposition: u.disposition || '',
          troubleshooting_notes: u.troubleshooting_notes || '',
          repairing_notes: u.repairing_notes || '',
          final_inspection_notes: u.final_inspection_notes || '',
          custom_values: u.custom_values && Object.keys(u.custom_values).length > 0 ? JSON.stringify(u.custom_values) : null,
          ...(selectedType === 'RMA_DIFF' ? {
            customer_ncr: u.customer_ncr || '',
            original_po_number: u.original_po_number || '',
            original_wo_number: u.original_wo_number || '',
            customer_revision_sent: u.customer_revision_sent || '',
            customer_revision_received: u.customer_revision_received || '',
            original_built_quantity: u.original_built_quantity || null,
            units_shipped: u.units_shipped || null,
          } : {}),
        })),
      } : {}),
    };

    try {
      const token = localStorage.getItem('nexus_token') || '';
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      // Check if a DRAFT already exists for this job_number + revision → update it instead of creating duplicate
      let existingDraftId: number | null = null;
      try {
        const checkResp = await fetch(
          `${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(fullJobNumber)}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (checkResp.ok) {
          const existing = await checkResp.json();
          if (existing && existing.status === 'DRAFT' && (existing.revision || 'A') === (travelerData.revision || 'A')) {
            existingDraftId = existing.id;
          }
        }
      } catch { /* ignore check failure, will create new */ }

      let response;
      if (existingDraftId) {
        // Update the existing DRAFT → CREATED
        response = await fetch(`${API_BASE_URL}/travelers/${existingDraftId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...travelerData, status: 'CREATED', is_active: true })
        });
      } else {
        // No existing draft — create new
        response = await fetch(`${API_BASE_URL}/travelers/`, {
          method: 'POST',
          headers,
          body: JSON.stringify(travelerData)
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = 'Failed to create traveler';
        try { errorMessage = JSON.parse(errorText).detail || errorMessage; } catch { errorMessage = errorText || errorMessage; }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      toast.success(`Traveler ${existingDraftId ? 'Updated from Draft' : 'Created'}! Job: ${fullJobNumber} | Part: ${editedTraveler.partNumber}`);
      setTimeout(() => {
        const id = result.id || result.traveler_id;
        window.location.href = id ? `/travelers/${id}` : '/travelers';
      }, 1500);
    } catch (error) {
      console.error('Error creating traveler:', error);
      toast.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSaveDraft = async () => {
    if (!editedTraveler) return;
    if (!editedTraveler.jobNumber) {
      toast.warning('Please enter a Job Number to save as draft.');
      return;
    }

    // If auto-filled, require at least one key field change
    if (autoFilledFrom) {
      let currentWorkOrder = '';
      if (workOrderPrefix && workOrderSuffix) {
        currentWorkOrder = `${workOrderPrefix}-${workOrderSuffix}`;
      } else if (workOrderPrefix) {
        currentWorkOrder = workOrderPrefix;
      } else {
        currentWorkOrder = editedTraveler.workOrder || '';
      }

      const woChanged = currentWorkOrder !== autoFilledFrom.workOrder;
      const revChanged = editedTraveler.revision !== autoFilledFrom.revision;
      const custRevChanged = (editedTraveler.customerRevision || '') !== autoFilledFrom.customerRevision;

      if (!woChanged && !revChanged && !custRevChanged) {
        toast.warning('This traveler was auto-filled from an existing one. You must change at least one of: Work Order, BOM Rev, or Customer Rev before saving.');
        return;
      }
    }

    let fullJobNumber = editedTraveler.jobNumber;
    if (isLeadFree) fullJobNumber += 'L';
    if (isITAR) fullJobNumber += 'M';

    let fullWorkOrder = '';
    if (workOrderPrefix && workOrderSuffix) {
      fullWorkOrder = `${workOrderPrefix}-${workOrderSuffix}`;
    } else if (workOrderPrefix) {
      fullWorkOrder = workOrderPrefix;
    } else {
      fullWorkOrder = editedTraveler.workOrder || fullJobNumber;
    }

    const travelerData = {
      job_number: fullJobNumber,
      work_order_number: fullWorkOrder,
      po_number: editedTraveler.poNumber || '',
      traveler_type: selectedType || 'PCB_ASSEMBLY',
      part_number: editedTraveler.partNumber || '',
      part_description: editedTraveler.description || '',
      revision: editedTraveler.revision || 'A',
      customer_revision: editedTraveler.customerRevision || '',
      part_revision: editedTraveler.partRevision || '',
      quantity: Number(editedTraveler.quantity) || 1,
      customer_code: editedTraveler.customerCode || '',
      customer_name: editedTraveler.customerName || '',
      priority: editedTraveler.priority || 'NORMAL',
      work_center: editedTraveler.steps.length > 0 ? editedTraveler.steps[0].workCenter || 'ASSEMBLY' : 'ASSEMBLY',
      status: 'DRAFT',
      is_active: false,
      include_labor_hours: false,
      notes: '',
      specs: JSON.stringify(editedTraveler.specs),
      specs_date: '',
      from_stock: editedTraveler.fromStock || '',
      to_stock: editedTraveler.toStock || '',
      ship_via: editedTraveler.shipVia || '',
      comments: editedTraveler.comments || '',
      start_date: editedTraveler.createdAt || '',
      due_date: editedTraveler.dueDate || '',
      ship_date: editedTraveler.shipDate || '',
      process_steps: editedTraveler.steps.map(step => ({
        step_number: Number(step.seq) || 0,
        operation: step.workCenter || '',
        work_center_code: dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.code || (step.workCenter || '').replace(/\s+/g, '_').toUpperCase() || 'UNKNOWN',
        instructions: step.instruction || '',
        estimated_time: 30,
        is_required: true,
        quantity: step.quantity ? Number(step.quantity) : null,
        accepted: step.accepted ? Number(step.accepted) : null,
        rejected: step.rejected ? Number(step.rejected) : null,
        sign: step.sign || null,
        completed_date: step.completedDate || null,
        completed_time: step.completedTime || null,
        sub_steps: []
      })),
      manual_steps: [],
      // RMA-specific fields for draft
      ...(isRmaType(selectedType || '') ? {
        rma_number: editedTraveler.rmaNumber || '',
        customer_contact: editedTraveler.customerContact || '',
        original_wo_number: editedTraveler.originalWoNumber || '',
        original_po_number: editedTraveler.originalPoNumber || '',
        return_po_number: editedTraveler.returnPoNumber || '',
        rma_po_number: editedTraveler.rmaPoNumber || '',
        invoice_number: editedTraveler.invoiceNumber || '',
        customer_ncr: editedTraveler.customerNcr || '',
        original_built_quantity: editedTraveler.originalBuiltQuantity || null,
        units_shipped: editedTraveler.unitsShipped || null,
        quantity_rma_issued: editedTraveler.quantityRmaIssued || null,
        units_received: editedTraveler.unitsReceived || null,
        customer_revision_sent: editedTraveler.customerRevisionSent || '',
        customer_revision_received: editedTraveler.customerRevisionReceived || '',
        rma_notes: editedTraveler.rmaNotes || '',
        wo_type_label: editedTraveler.travelerType === 'MODIFICATION' ? (editedTraveler.woTypeLabel || 'Modification') : null,
        rma_table_columns: editedTraveler.rmaTableColumns ? JSON.stringify(editedTraveler.rmaTableColumns) : null,
        rma_units: (editedTraveler.rmaUnits || []).filter(u => u.serial_number || u.customer_complaint || (u.custom_values && Object.values(u.custom_values).some(v => v))).map(u => ({
          unit_number: u.unit_number,
          serial_number: u.serial_number || '',
          customer_complaint: u.customer_complaint || '',
          incoming_inspection_notes: u.incoming_inspection_notes || '',
          disposition: u.disposition || '',
          troubleshooting_notes: u.troubleshooting_notes || '',
          repairing_notes: u.repairing_notes || '',
          final_inspection_notes: u.final_inspection_notes || '',
          custom_values: u.custom_values && Object.keys(u.custom_values).length > 0 ? JSON.stringify(u.custom_values) : null,
        })),
      } : {}),
    };

    try {
      const response = await fetch(`${API_BASE_URL}/travelers/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('nexus_token') || ''}`
        },
        body: JSON.stringify(travelerData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      toast.success(`Draft Saved! Job: ${fullJobNumber} | Status: DRAFT`);
      setTimeout(() => {
        const id = result.id;
        window.location.href = id ? `/travelers/${id}` : '/travelers';
      }, 1500);
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // ---- Create Mode: Type Selection Screen ----
  // Look up a job / RMA number and auto-fill. The lookup resolves job numbers,
  // RMA & MOD work order numbers, and composite strings ("1108 RMA JOB 8500L"),
  // so RMA and Modification travelers can be duplicated the same as any other.
  const autoFillFromExistingJob = async (jobNumber: string) => {
    if (!jobNumber || jobNumber.length < 2) return;
    try {
      const token = localStorage.getItem('nexus_token');
      if (!token) return;
      const response = await fetch(`${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(jobNumber)}/all-work-orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        toast.warning('No existing traveler found with that job number. Please select a type to create a new one.');
        return;
      }
      const matches: LookupTraveler[] = await response.json();
      if (!Array.isArray(matches) || matches.length === 0) {
        toast.warning('No existing traveler found with that job number. Please select a type to create a new one.');
        return;
      }
      if (matches.length > 1) {
        // e.g. job 8500L has both a PCB Assembly build and RMA 1108 — the user
        // picks which one to duplicate instead of us guessing.
        setExistingWorkOrders(matches);
        setShowWorkOrderSelector(true);
        toast.info(`Found ${matches.length} travelers for "${jobNumber}". Select which one to auto-fill from.`);
        return;
      }
      await applyAutoFill(matches[0]);
    } catch (error) {
      console.error('Error looking up job number:', error);
      toast.error('Error looking up job number.');
    }
  };

  // Copy every field of an existing traveler into the create form
  const applyAutoFill = async (data: LookupTraveler) => {
    try {
      const token = localStorage.getItem('nexus_token');
      setShowWorkOrderSelector(false);
      setExistingWorkOrders([]);

      // BOM Rev is manually set — carry the source revision through as-is
      // and require the user to change it (or another unique field) before
      // save. See the warning toast below.
      const oldRevision = String(data.revision || 'A');
      const newRevision = oldRevision;
      const type = (data.traveler_type || 'PCB_ASSEMBLY') as TravelerType;

      // Parse specs
      let specsArr: Specification[] = [];
      try {
        const specsData = data.specs;
        if (specsData) {
          if (typeof specsData === 'string') {
            const parsed = JSON.parse(specsData);
            if (Array.isArray(parsed)) {
              specsArr = parsed.map((s: Record<string, unknown>, i: number) => ({ id: String(i + 1), text: String(s.text || ''), date: String(s.date || '') }));
            }
          } else if (Array.isArray(specsData)) {
            specsArr = specsData.map((s: Record<string, unknown>, i: number) => ({ id: String(i + 1), text: String(s.text || ''), date: String(s.date || '') }));
          }
        }
      } catch { /* ignore */ }

      // Split work order
      if (data.work_order_number) {
        const parts = data.work_order_number.split('-');
        if (parts.length >= 2) {
          setWorkOrderPrefix(parts[0]);
          setWorkOrderSuffix(parts.slice(1).join('-'));
        } else {
          setWorkOrderPrefix(data.work_order_number);
          setWorkOrderSuffix('');
        }
      }

      // Build process steps from existing
      const steps: ProcessStep[] = (data.process_steps || []).map((step: Record<string, unknown>, index: number) => ({
        seq: Number(step.step_number) || index + 1,
        workCenter: String(step.operation || step.work_center_code || ''),
        instruction: String(step.instructions || ''),
        quantity: '',
        accepted: '',
        rejected: '',
        sign: '',
        completedDate: '',
        status: 'PENDING',
        assignee: ''
      }));

      const today = new Date().toISOString().split('T')[0];
      const filledTraveler: Traveler = {
        id: '',
        travelerId: 0,
        jobNumber: data.job_number,
        workOrder: data.work_order_number || '',
        poNumber: data.po_number || '',
        partNumber: data.part_number || '',
        description: data.part_description || '',
        revision: newRevision,
        customerRevision: data.customer_revision || '',
        partRevision: data.part_revision || '',
        quantity: data.quantity || 0,
        customerCode: data.customer_code || '',
        customerName: data.customer_name || '',
        status: 'CREATED',
        createdAt: today,
        dueDate: data.due_date ? String(data.due_date).split('T')[0] : '',
        shipDate: data.ship_date ? String(data.ship_date).split('T')[0] : '',
        specs: specsArr,
        fromStock: data.from_stock || '',
        toStock: data.to_stock || '',
        shipVia: data.ship_via || '',
        comments: data.comments || '',
        steps: steps,
        laborEntries: Array.from({ length: 20 }, (_, i) => ({
          id: String(i + 1),
          workCenter: '',
          operatorName: '',
          startTime: '',
          endTime: '',
          totalHours: ''
        })),
        travelerType: type,
        isActive: true,
        includeLaborHours: data.include_labor_hours || false,
        priority: data.priority || 'NORMAL'
      };

      setSelectedType(type);
      setEditedTraveler(filledTraveler);
      setTraveler(filledTraveler);
      setIncludeLaborHours(data.include_labor_hours || false);
      setShowForm(true);

      // Track auto-filled values so we can require changes before saving
      setAutoFilledFrom({
        workOrder: data.work_order_number || '',
        revision: newRevision,
        customerRevision: data.customer_revision || '',
      });

      toast.info(`Auto-filled from existing traveler (BOM Rev ${oldRevision}). Update the BOM Rev manually, or change Work Order / Customer Rev, before saving.`);

      // Check for BOM shortages (non-blocking warning)
      try {
        const shortageRes = await fetch(`${API_BASE_URL}/jobs/${encodeURIComponent(data.job_number)}/kitting-status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (shortageRes.ok) {
          const ks = await shortageRes.json();
          if (ks.short > 0) {
            toast.warning(`This job has ${ks.short} component shortage${ks.short > 1 ? 's' : ''}. ${ks.kitted} of ${ks.total_components} components kitted (${ks.percent}%).`, { duration: 8000 });
          }
        }
      } catch { /* non-critical */ }

      // Check for existing active travelers (duplicate warning)
      try {
        const travelersRes = await fetch(`${API_BASE_URL}/jobs/${encodeURIComponent(data.job_number)}/travelers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (travelersRes.ok) {
          const td = await travelersRes.json();
          const activeTravelers = (td.travelers || []).filter((t: { status: string }) => !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status));
          if (activeTravelers.length > 0) {
            toast.warning(`${activeTravelers.length} active traveler${activeTravelers.length > 1 ? 's' : ''} already exist${activeTravelers.length === 1 ? 's' : ''} for this job.`, { duration: 8000 });
          }
        }
      } catch { /* non-critical */ }
    } catch (error) {
      console.error('Error auto-filling from traveler:', error);
      toast.error('Error auto-filling from that traveler.');
    }
  };

  if (createMode && !showForm) {
    return (
      <Layout fullWidth>
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-50 via-green-50 to-orange-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 p-3 mb-4">
              <DocumentTextIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 dark:text-slate-100 tracking-tight">Create New Traveler</h1>
            <p className="text-gray-500 dark:text-slate-400 mt-2 text-lg">Choose the traveler type to get started</p>
          </div>

          {/* Job Number Lookup */}
          <div className="max-w-3xl w-full mb-6 bg-white dark:bg-slate-800 rounded-xl border-2 border-indigo-200 dark:border-slate-600 p-5 shadow-sm">
            <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">
              Have an existing Job Number? Enter it to auto-fill everything:
            </label>
            <input
              type="text"
              placeholder="Job, RMA / MOD, work order or PO number (e.g. 8744 PARTS, 1108, 1108 RMA JOB 8500L) and press Enter"
              className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-4 py-3 text-sm font-bold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  autoFillFromExistingJob((e.target as HTMLInputElement).value.trim());
                }
              }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val.length >= 2) autoFillFromExistingJob(val);
              }}
            />
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Press Enter or tab out to search. Works with a job number, an RMA / Modification number, a work order, or a PO. Auto-fills all details, steps, and selects the correct type.</p>
          </div>

          {/* Work Order Selector — shown when a job has more than one traveler
              (e.g. the original build plus an RMA or Modification) */}
          {showWorkOrderSelector && existingWorkOrders.length > 0 && (
            <div className="max-w-3xl w-full mb-6 bg-white dark:bg-slate-800 rounded-xl border-2 border-amber-300 dark:border-amber-600 p-5 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">
                  Select the traveler to auto-fill from
                </h3>
                <button
                  onClick={() => { setShowWorkOrderSelector(false); setExistingWorkOrders([]); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 text-lg font-bold"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {existingWorkOrders.map((wo) => {
                  const typeInfo = TRAVELER_TYPE_LINES[wo.traveler_type || ''];
                  return (
                    <button
                      key={wo.id ?? `${wo.job_number}-${wo.work_order_number}`}
                      onClick={() => applyAutoFill(wo)}
                      className="w-full text-left p-3 rounded-lg border-2 border-gray-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-sm text-gray-800 dark:text-slate-200">{typeInfo?.name || wo.traveler_type}</span>
                          <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">{typeInfo?.line || ''}</span>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 whitespace-nowrap">{wo.status}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        <span className="font-bold text-gray-800 dark:text-slate-200">Job: {wo.job_number}</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">WO: {wo.work_order_number || '—'}</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">PO: {wo.po_number || '—'}</span>
                        <span className="text-gray-500 dark:text-slate-400">BOM Rev: {wo.revision || '—'}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                        {wo.part_number} - {wo.part_description} | Qty: {wo.quantity}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 max-w-5xl w-full px-2 sm:px-0">
            {travelerTypes.map((type) => {
              const IconComponent = type.icon;
              return (
                <button
                  key={type.value}
                  onClick={() => handleTypeSelect(type.value as TravelerType)}
                  className={`group relative overflow-hidden rounded-2xl border-2 ${type.borderColor} bg-gradient-to-br ${type.gradient} p-0 text-left text-white shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-[1.03] hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-blue-300`}
                >
                  {/* Decorative bubbles */}
                  <div className={`absolute -top-6 -right-6 w-24 h-24 ${type.bubbleColor} rounded-full opacity-60 group-hover:scale-125 transition-transform duration-500`}></div>
                  <div className={`absolute -bottom-4 -left-4 w-16 h-16 ${type.bubbleColor} rounded-full opacity-40 group-hover:scale-150 transition-transform duration-700`}></div>
                  <div className={`absolute top-1/2 right-1/4 w-10 h-10 ${type.bubbleColor} rounded-full opacity-30 group-hover:scale-125 transition-transform duration-600`}></div>

                  <div className="relative z-10 p-6">
                    {/* Icon */}
                    <div className={`${type.iconBg} backdrop-blur-sm rounded-xl p-3 w-fit mb-4 group-hover:scale-110 transition-transform duration-300`}>
                      <IconComponent className="h-8 w-8 text-white" />
                    </div>

                    {/* Title & Description */}
                    <h3 className="text-xl font-bold mb-1 tracking-tight">{type.label}</h3>
                    <p className="text-sm text-white/85 mb-3">{type.description}</p>

                    {/* Subtitle tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {type.subtitle.split(', ').map((tag) => (
                        <span key={tag} className="inline-block bg-white/20 backdrop-blur-sm text-white text-xs font-medium px-2 py-0.5 rounded-full border border-white/20">
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Arrow indicator */}
                    <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                      <div className="bg-white/25 rounded-full p-1.5">
                        <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Back button */}
          <button
            onClick={() => router.back()}
            className="mt-8 flex items-center space-x-2 px-5 py-2.5 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full shadow-sm hover:shadow transition-all duration-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="text-sm font-medium">Back to Travelers</span>
          </button>
        </div>
      </Layout>
    );
  }

  // In create mode, if we haven't selected a type yet, editedTraveler is null
  if (createMode && !editedTraveler) {
    return (
      <Layout fullWidth>
        <div className="flex items-center justify-center h-64">
          <div className="text-xl text-gray-600 dark:text-slate-400">Initializing...</div>
        </div>
      </Layout>
    );
  }

  if (isLoading && !createMode) {
    return (
      <Layout fullWidth>
        <div className="flex items-center justify-center h-64">
          <div className="text-xl text-gray-600 dark:text-slate-400">Loading traveler...</div>
        </div>
      </Layout>
    );
  }

  if (!createMode && !traveler && !editedTraveler) {
    return (
      <Layout fullWidth>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          {loadError === 'auth' ? (
            <>
              <div className="text-xl text-red-600">Your session has expired</div>
              <div className="text-sm text-gray-600 dark:text-slate-400">
                This traveler is still here — you just need to sign in again.
              </div>
              <button
                onClick={logout}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Log in again
              </button>
            </>
          ) : (
            <div className="text-xl text-red-600">Traveler not found</div>
          )}
        </div>
      </Layout>
    );
  }

  const displayTraveler = isEditing ? editedTraveler : traveler;
  if (!displayTraveler) return null;
  // When isEditing is true, editedTraveler is guaranteed non-null (same as displayTraveler)
  const editData = editedTraveler as Traveler;

  return (
    <Layout fullWidth>
      <style>{`
        * { font-family: Arial, Helvetica, sans-serif !important; }

        /* Print-only elements hidden on screen, screen-only elements hidden in print */
        .print-only { display: none !important; }

        /* Always show desktop tables, always hide mobile card views */
        .routing-table-desktop {
          display: table !important;
        }
        .routing-cards-mobile {
          display: none !important;
        }
        .labor-table-desktop {
          display: table !important;
        }
        .labor-cards-mobile {
          display: none !important;
        }

        /* Header styling for digital version */
        .bg-gray-100.border-b-2 { padding: 0.5rem 1rem; }
        .bg-gray-100 .grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 0;
          align-items: center;
        }
        .bg-gray-100 .grid > div:first-child {
          text-align: left;
          padding-right: 1rem;
        }
        .bg-gray-100 .grid > div:nth-child(2) {
          text-align: center;
          padding: 0 1rem;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .bg-gray-100 .grid > div:last-child {
          text-align: right;
          padding-left: 1rem;
        }
        .bg-gray-100 .space-y-0\\.5 {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .bg-gray-100 .flex {
          gap: 0.5rem;
          align-items: baseline;
          justify-content: flex-end;
        }
        .bg-gray-100 .grid > div:first-child .flex {
          justify-content: flex-start;
        }
        .bg-gray-100 .text-center {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        @media print {
          /* Force light mode for print — override ALL dark mode styles */
          html { color-scheme: light !important; }
          html.dark, html.dark body { background: white !important; color: black !important; }
          body { background: white !important; color: black !important; }

          /* Strip all dark mode backgrounds */
          .dark .bg-slate-900, .dark .bg-slate-800, .dark .bg-slate-700,
          .dark .bg-gray-900, .dark .bg-gray-800, .dark .bg-gray-700,
          [class*="dark:bg-slate"], [class*="dark:bg-gray"] {
            background-color: white !important;
          }

          /* Force all text to black in print */
          .dark .text-white, .dark .text-slate-100, .dark .text-slate-200,
          .dark .text-slate-300, .dark .text-slate-400,
          .dark .text-gray-100, .dark .text-gray-200, .dark .text-gray-300,
          [class*="dark:text-white"], [class*="dark:text-slate"], [class*="dark:text-gray"] {
            color: black !important;
            -webkit-text-fill-color: black !important;
          }

          /* Force dark mode borders to visible gray */
          .dark .border-slate-600, .dark .border-slate-700, .dark .border-slate-800,
          [class*="dark:border-slate"] {
            border-color: #9ca3af !important;
          }

          /* Fix section backgrounds that use dark variants */
          [class*="dark:from-"], [class*="dark:to-"], [class*="dark:via-"] {
            background-image: none !important;
          }
          .bg-blue-50, .bg-green-50, .bg-yellow-50, .bg-purple-50, .bg-indigo-50 {
            background-color: inherit !important;
          }

          /* Override mobile-hide to show all columns when printing */
          .mobile-hide {
            display: table-cell !important;
          }

          /* Show desktop table and hide mobile cards for print */
          .routing-table-desktop {
            display: table !important;
          }
          .routing-cards-mobile {
            display: none !important;
          }
          .labor-table-desktop {
            display: table !important;
          }
          .labor-cards-mobile {
            display: none !important;
          }

          @page {
            margin: 0.25in;
            size: letter;
          }
          /* RMA travelers print in landscape */
          @page rma-landscape {
            size: letter landscape;
            margin: 0.15in 0.2in;
          }
          .rma-landscape-print {
            page: rma-landscape;
          }
          /* RMA print-specific overrides */
          .rma-landscape-print table { font-size: 12px !important; }
          .rma-landscape-print table td,
          .rma-landscape-print table th { padding: 3px 5px !important; }
          .rma-landscape-print .bg-gray-100 { padding: 4px 8px !important; }
          .rma-landscape-print .bg-gray-50 { padding: 2px 6px !important; }
          /* RMA: Keep header + routing steps on page 1, unit tracking on page 2 */
          .rma-landscape-print .rma-page1-content { page-break-inside: avoid !important; break-inside: avoid !important; }
          .rma-landscape-print .rma-page2-content { page-break-before: always !important; break-before: page !important; }
          /* RMA barcode in print — keep bars crisp for laser scanners.
             Do NOT force height/width: native size from backend is print-grade (300dpi);
             CSS scaling introduces anti-aliasing that breaks scanning. */
          .rma-landscape-print img[alt*="Barcode"],
          .rma-landscape-print .rma-header-banner img {
            width: auto !important;
            height: auto !important;
            max-width: none !important;
            max-height: 130px !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            filter: contrast(1.5) brightness(0.95) !important;
            image-rendering: pixelated !important;
            image-rendering: -moz-crisp-edges !important;
            image-rendering: crisp-edges !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background: white !important;
          }
          .rma-landscape-print .rma-header-table td { padding: 8px 14px !important; font-size: 17px !important; line-height: 1.5 !important; }
          .rma-landscape-print .rma-header-table .font-bold { font-size: 16px !important; }
          .rma-landscape-print .rma-header-table input { font-size: 16px !important; padding: 4px 8px !important; }
          /* RMA top banner: enlarged Job No / RMA ROUTING / stock column */
          .rma-landscape-print .rma-header-banner td { padding: 12px 16px !important; font-size: 18px !important; line-height: 1.4 !important; }
          .rma-landscape-print .rma-header-banner .text-xl { font-size: 36px !important; }
          .rma-landscape-print .rma-header-banner .text-2xl { font-size: 42px !important; }
          .rma-landscape-print .rma-header-banner .text-lg { font-size: 26px !important; }
          .rma-landscape-print .rma-header-banner .text-\\[10px\\] { font-size: 15px !important; }
          .rma-landscape-print .rma-header-banner .font-bold { font-size: 18px !important; }
          /* Compact routing table for print */
          .rma-landscape-print .routing-table-desktop td { padding: 1px 3px !important; font-size: 8px !important; height: 22px !important; }
          .rma-landscape-print .routing-table-desktop th { padding: 1px 3px !important; font-size: 8px !important; }
          /* Compact notes for print */
          .rma-landscape-print .rma-notes-section { padding: 2px 6px !important; }
          .rma-landscape-print .rma-notes-section span { font-size: 8px !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            font-family: Arial, Helvetica, sans-serif !important;
            color: black !important;
            box-decoration-break: clone !important;
            -webkit-box-decoration-break: clone !important;
          }
          body { font-size: 10px !important; margin: 0 !important; padding: 0 !important; }

          /* Prevent borders from being cut off - increased border thickness */
          table, tr, td, th, div {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* Increase all border thickness for print */
          .border { border-width: 2px !important; }
          .border-2 { border-width: 3px !important; }
          .border-b { border-bottom-width: 2px !important; }
          .border-b-2 { border-bottom-width: 3px !important; }
          .border-r { border-right-width: 2px !important; }
          .border-r-2 { border-right-width: 3px !important; }
          table.border-collapse { border-width: 3px !important; }

          /* Keep table rows together */
          tbody tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .max-w-7xl { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .p-6, .p-2, .py-4, .px-4 { padding: 0 !important; }
          .sm\\:px-6, .lg\\:px-8, .sm\\:p-4, .lg\\:p-6 { padding: 0 !important; }
          main { padding: 0 !important; margin: 0 !important; }
          .min-h-screen { min-height: auto !important; background: white !important; }
          .bg-gray-50 { background: white !important; }
          .shadow-lg, .shadow-md, .shadow-sm { box-shadow: none !important; }
          .rounded-lg { border-radius: 0 !important; }

          /* Reduce spacing between sections - keep routing directly below specifications */
          .border-b, .border-b-2 { margin-bottom: 0 !important; margin-top: 0 !important; }
          .space-y-4 > *, .space-y-6 > * { margin-top: 0 !important; margin-bottom: 0 !important; }
          .space-y-4, .space-y-6 { gap: 0 !important; }
          .gap-2, .gap-3 { gap: 0 !important; }

          /* Hide elements with no-print class */
          .no-print { display: none !important; }

          /* Edit/Create mode print: hide inputs, show values as text, remove colored borders */
          input, select, textarea {
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            font-size: inherit !important;
            color: black !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            appearance: none !important;
            box-shadow: none !important;
            outline: none !important;
          }
          textarea { min-height: 0 !important; height: auto !important; resize: none !important; overflow: hidden !important; }
          input[type="date"] { font-size: 11px !important; -webkit-appearance: none !important; }
          input[type="date"]::-webkit-calendar-picker-indicator { display: none !important; }
          input[type="date"]::-webkit-inner-spin-button { display: none !important; }
          input[type="number"] { -moz-appearance: textfield !important; }
          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button { display: none !important; }

          /* Hide ALL buttons in print (edit UI, drag handles, add step, etc.) */
          button { display: none !important; }

          /* Hide edit-only columns (drag handle / delete) */
          .no-print { display: none !important; }

          /* Make edit mode table cells match view mode: thick gray-400 borders */
          table td, table th {
            border: 2px solid #9ca3af !important;
          }

          /* Force table layout to auto in print (override isEditing fixed layout) */
          table.routing-table { table-layout: fixed !important; width: 100% !important; }

          /* Edit mode header inputs - show as plain text */
          .bg-green-50 input, .bg-green-50 select,
          .bg-blue-50 input, .bg-blue-50 select,
          .bg-gray-100 input, .bg-gray-100 select,
          .bg-yellow-50 input, .bg-yellow-50 select {
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
            font-size: 11px !important;
            color: black !important;
          }

          /* Edit mode colored input backgrounds - make transparent */
          input.bg-gray-50, input.bg-red-50, input.bg-green-50, input.bg-purple-50, input.bg-white,
          select.bg-white {
            background: transparent !important;
          }

          /* Edit mode cell font sizes to match view mode */
          table tbody td input, table tbody td select, table tbody td textarea {
            font-size: 11px !important;
            font-weight: bold !important;
            text-align: center !important;
            color: black !important;
            width: 100% !important;
          }

          /* Edit mode: SQ column input */
          table.editing-mode tbody td:nth-child(2) input {
            text-align: center !important;
            font-size: 10px !important;
            font-weight: bold !important;
          }
          /* Edit mode: Work Center select - show as left-aligned text */
          table.editing-mode tbody td:nth-child(3) select {
            text-align: left !important;
            font-size: 10px !important;
            font-weight: 700 !important;
          }
          /* Edit mode: Instructions textarea */
          table.editing-mode tbody td:nth-child(4) textarea {
            text-align: left !important;
            font-size: 9px !important;
            font-weight: normal !important;
          }
          /* Edit mode: TIME/QTY/REJ/ACC/SIGN/DATE - show underline like view mode when empty */
          table.editing-mode tbody td:nth-child(5) input,
          table.editing-mode tbody td:nth-child(6) input,
          table.editing-mode tbody td:nth-child(7) input,
          table.editing-mode tbody td:nth-child(8) input,
          table.editing-mode tbody td:nth-child(9) input,
          table.editing-mode tbody td:nth-child(10) input {
            font-size: 10px !important;
            text-align: center !important;
            border-bottom: 1px solid #9ca3af !important;
            min-height: 16px !important;
          }

          /* View mode column selectors (no extra col) */
          table.routing-table:not(.editing-mode) tbody td:nth-child(2) span {
            font-size: 10px !important;
          }
          table.routing-table:not(.editing-mode) tbody td:nth-child(3) {
            font-size: 9px !important;
          }

          /* Hide select dropdown arrows in print */
          select::-ms-expand { display: none !important; }

          /* Show print-only elements, hide screen-only elements */
          .print-only { display: inline !important; }
          .screen-only { display: none !important; }

          /* Hide mobile sections in print */
          .block.md\\:hidden.print\\:hidden { display: none !important; }

          /* Keep section background colors for print */
          .bg-yellow-200, .bg-yellow-50, .bg-blue-200, .bg-purple-200, .bg-purple-100, .bg-gray-100 {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Header section - Ultra compact like 1.jpg - force 3 columns in single row */
          .bg-gray-100.border-b-2 { padding: 0.2rem 0.5rem !important; }
          .bg-gray-100 .grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr 1fr !important;
            gap: 0 !important;
            align-items: center !important;
          }
          .bg-gray-100 .grid > div:first-child { text-align: left !important; padding-right: 0.5rem !important; }
          .bg-gray-100 .grid > div:nth-child(2) {
            text-align: center !important;
            padding: 0 0.5rem !important;
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
          }
          .bg-gray-100 .grid > div:last-child { text-align: right !important; padding-left: 0.5rem !important; }
          .bg-gray-100 .space-y-0\\.5 { row-gap: 0.2rem !important; margin: 0 !important; }
          .bg-gray-100 .flex { gap: 0.25rem !important; margin: 0 !important; align-items: baseline !important; justify-content: flex-end !important; }
          .bg-gray-100 .grid > div:first-child .flex { justify-content: flex-start !important; }
          .bg-gray-100 span { font-size: 12px !important; line-height: 1.4 !important; margin: 0 !important; padding: 0 !important; }
          .bg-gray-100 .font-bold { font-size: 12px !important; min-width: 70px !important; }
          .bg-gray-100 .text-xs { font-size: 12px !important; }
          .bg-gray-100 .text-\[10px\] { font-size: 12px !important; }

          /* Barcode - bigger and centered with tighter spacing */
          .bg-gray-100 img { width: 180px !important; height: 55px !important; display: block !important; margin: 0 auto !important; }
          .bg-gray-100 .border-2 { padding: 0.1rem !important; border-width: 1px !important; margin: 0 auto !important; display: inline-block !important; }
          .bg-gray-100 .text-xl { font-size: 14px !important; font-weight: 900 !important; text-align: center !important; }
          .bg-gray-100 .text-center { margin: 0 auto !important; padding: 0 !important; text-align: center !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; }

          /* Section headers - minimal padding like 1.jpg */
          .bg-yellow-200, .bg-blue-200, .bg-purple-200 { padding: 0.05rem 0.2rem !important; margin: 0 !important; }
          .bg-yellow-200 h2, .bg-blue-200 h2, .bg-purple-200 h2 { font-size: 12px !important; font-weight: bold !important; margin: 0 !important; }

          /* Keep all sections together - prevent page breaks between header, specs, and routing */
          .bg-gray-100.border-b-2 { page-break-after: avoid !important; break-after: avoid !important; }
          .bg-yellow-200.border-b { page-break-after: avoid !important; break-after: avoid !important; page-break-before: avoid !important; break-before: avoid !important; }
          .bg-yellow-50 { page-break-after: avoid !important; break-after: avoid !important; }
          .bg-blue-200.border-b { page-break-before: avoid !important; break-before: avoid !important; page-break-after: avoid !important; break-after: avoid !important; }
          .border-b.border-black:not(.bg-purple-200) { page-break-inside: avoid !important; break-inside: avoid !important; }

          /* ROUTING must start directly under its title. The step table is
             taller than a page, so the section itself has to be breakable —
             forcing break-inside:avoid on it made the browser bail out and push
             the table to the next page, leaving the title stranded. Instead:
             let the section and table flow, glue the title to the table, keep
             individual rows intact, and repeat the header on each page. */
          /* Repeat the traveler header (job #, part/desc, barcode, dates) at the
             top of every printed page, so a page separated on the floor can
             still be identified. The header is a plain div sitting outside the
             routing table, so it cannot ride the <thead> repeat the column
             headers use below. Casting the document to a table in print only
             makes the header a running header group, which the browser redraws
             on each page. Screen is untouched (blocks stay blocks) and page 1 is
             unchanged, because the header is still the first thing in flow.
             Applies to every traveler type. The standard and RMA headers are
             mutually exclusive and both live in the header group, so whichever
             one a traveler renders is the one that repeats — RMA keeps its own
             landscape @page and page1/page2 rules on top of this.
             The blanket div page-break-inside:avoid rule above would pin these
             wrappers to one page, so both opt back out to auto. */
          .traveler-doc { display: table !important; width: 100% !important;
                          page-break-inside: auto !important; break-inside: auto !important; }
          .traveler-doc > .traveler-doc-header {
            display: table-header-group !important;
            page-break-inside: avoid !important; break-inside: avoid !important;
            page-break-after: avoid !important; break-after: avoid !important;
          }
          .traveler-doc > .traveler-doc-body {
            display: table-row-group !important;
            page-break-inside: auto !important; break-inside: auto !important;
          }

          /* TIME used to hold "0.16" and now holds "44h 41m", which at 10px bold
             is wider than the 48px column. Shrink just this column's data — the
             DATE column is deliberately left alone. */
          table.routing-table tbody td:nth-child(4),
          table.routing-table tbody td:nth-child(4) span,
          table.editing-mode tbody td:nth-child(5),
          table.editing-mode tbody td:nth-child(5) span,
          table.editing-mode tbody td:nth-child(5) input {
            font-size: 9px !important;
            font-weight: normal !important;
            white-space: nowrap !important;
          }

          /* DATE must never clip its year ("05/06/20"). Slightly smaller than the
             other columns and nowrap, on a column widened to match. */
          table.routing-table tbody td:nth-child(9),
          table.routing-table tbody td:nth-child(9) span,
          table.editing-mode tbody td:nth-child(10),
          table.editing-mode tbody td:nth-child(10) span,
          table.editing-mode tbody td:nth-child(10) input {
            font-size: 7.5px !important;
            white-space: nowrap !important;
          }

          /* SIGN holds first names now, not 3-letter initials. Bold at this size
             reads worse and takes more width, so the data (not the header) is
             set normal weight, at the same size as DATE — several operators can
             share a step, and the smaller size keeps those names to fewer lines. */
          table.routing-table tbody td:nth-child(8),
          table.routing-table tbody td:nth-child(8) span,
          table.editing-mode tbody td:nth-child(9),
          table.editing-mode tbody td:nth-child(9) span,
          table.editing-mode tbody td:nth-child(9) input {
            font-size: 7.5px !important;
            font-weight: normal !important;
          }

          .routing-section { page-break-inside: auto !important; break-inside: auto !important; }
          .routing-section > div:first-child { page-break-after: avoid !important; break-after: avoid !important; }
          .routing-table-wrap { page-break-before: avoid !important; break-before: avoid !important; page-break-inside: auto !important; break-inside: auto !important; }
          table.routing-table { page-break-before: avoid !important; break-before: avoid !important; page-break-inside: auto !important; break-inside: auto !important; }
          table.routing-table thead { display: table-header-group !important; }
          table.routing-table thead tr { page-break-after: avoid !important; break-after: avoid !important; }
          table.routing-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }

          /* Section content compact */
          .bg-yellow-50, .bg-purple-50 { padding: 0.05rem 0.1rem !important; font-size: 9px !important; margin: 0 !important; }
          .bg-purple-50 { padding: 0.1rem !important; min-height: 30px !important; }
          .bg-purple-50 .whitespace-pre-wrap { font-size: 9px !important; }

          /* Table headers - bigger font */
          thead th { padding: 0.2rem !important; font-size: 12px !important; font-weight: bold !important; }

          /* Table cells - bigger font */
          tbody td { padding: 0.2rem !important; }
          tbody td.text-lg { font-size: 12px !important; }
          tbody td.text-base { font-size: 12px !important; }
          tbody td.font-semibold { font-size: 11px !important; font-weight: 700 !important; } /* Work center - reduced to prevent overflow */

          /* Column width adjustments for print - View mode (no extra column) */
          table.routing-table { table-layout: fixed !important; width: 100% !important; }

          table.routing-table thead th:nth-child(1),
          table.routing-table tbody td:nth-child(1) { width: 28px !important; } /* SQ */

          table.routing-table thead th:nth-child(2),
          table.routing-table tbody td:nth-child(2) { width: 130px !important; word-wrap: break-word !important; overflow-wrap: break-word !important; } /* WORK CENTER */

          table.routing-table thead th:nth-child(3),
          table.routing-table tbody td:nth-child(3) { width: 150px !important; } /* INSTRUCTIONS */

          table.routing-table thead th:nth-child(4),
          table.routing-table tbody td:nth-child(4) { width: 55px !important; } /* TIME */

          table.routing-table thead th:nth-child(5),
          table.routing-table tbody td:nth-child(5) { width: 48px !important; } /* QTY */

          table.routing-table thead th:nth-child(6),
          table.routing-table tbody td:nth-child(6) { width: 48px !important; } /* REJ */

          table.routing-table thead th:nth-child(7),
          table.routing-table tbody td:nth-child(7) { width: 48px !important; } /* ACC */

          table.routing-table thead th:nth-child(8),
          table.routing-table tbody td:nth-child(8) { width: 100px !important; word-wrap: break-word !important; overflow-wrap: break-word !important; white-space: normal !important; } /* SIGN — full first names, several operators may share a step */

          table.routing-table thead th:nth-child(9),
          table.routing-table tbody td:nth-child(9) { width: 70px !important; } /* DATE */

          /* Edit/Create mode: collapse hidden drag column and set correct column widths */
          table.editing-mode thead th.no-print,
          table.editing-mode tbody td.no-print { width: 0px !important; min-width: 0px !important; max-width: 0px !important; padding: 0 !important; border: none !important; overflow: hidden !important; font-size: 0 !important; }

          /* Edit mode column widths (shifted +1 because hidden col 1 still counted by nth-child) */
          table.editing-mode thead th:nth-child(2),
          table.editing-mode tbody td:nth-child(2) { width: 28px !important; } /* SQ */
          table.editing-mode thead th:nth-child(3),
          table.editing-mode tbody td:nth-child(3) { width: 130px !important; word-wrap: break-word !important; } /* WORK CENTER */
          table.editing-mode thead th:nth-child(4),
          table.editing-mode tbody td:nth-child(4) { width: 150px !important; } /* INSTRUCTIONS */
          table.editing-mode thead th:nth-child(5),
          table.editing-mode tbody td:nth-child(5) { width: 55px !important; } /* TIME */
          table.editing-mode thead th:nth-child(6),
          table.editing-mode tbody td:nth-child(6) { width: 48px !important; } /* QTY */
          table.editing-mode thead th:nth-child(7),
          table.editing-mode tbody td:nth-child(7) { width: 48px !important; } /* REJ */
          table.editing-mode thead th:nth-child(8),
          table.editing-mode tbody td:nth-child(8) { width: 48px !important; } /* ACC */
          table.editing-mode thead th:nth-child(9),
          table.editing-mode tbody td:nth-child(9) { width: 100px !important; word-wrap: break-word !important; overflow-wrap: break-word !important; white-space: normal !important; } /* SIGN */
          table.editing-mode thead th:nth-child(10),
          table.editing-mode tbody td:nth-child(10) { width: 70px !important; } /* DATE */

          /* QR code alignment in work center column - view mode (col 2) and edit mode (col 3) */
          table.routing-table tbody td:nth-child(2) .flex,
          table.routing-table tbody td:nth-child(3) .flex,
          table.editing-mode tbody td:nth-child(3) .flex,
          table.editing-mode tbody td:nth-child(4) .flex {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            align-items: center !important;
          }
          table.routing-table tbody td:nth-child(2) img,
          table.routing-table tbody td:nth-child(3) img,
          table.editing-mode tbody td:nth-child(3) img,
          table.editing-mode tbody td:nth-child(4) img {
            margin-left: auto !important;
          }

          /* QR codes in table - bigger for better scanning */
          tbody td img { width: 40px !important; height: 40px !important; }
          tbody td .flex { gap: 0.1rem !important; }

          /* Additional Instructions */
          .bg-gray-50.border-b-2 { padding: 0.2rem !important; min-height: 750px !important; }
          .bg-gray-50 .text-gray-400 { font-size: 9px !important; }

          /* Bottom section compact - force 3 columns in one row */
          .bg-gray-50.px-3 {
            padding: 0.2rem !important;
            gap: 0.3rem !important;
            font-size: 10px !important;
            display: grid !important;
            grid-template-columns: 1fr 1fr 1fr !important;
          }
          .bg-gray-50.px-3 .font-bold { font-size: 10px !important; min-width: 50px !important; }
          .bg-gray-50.px-3 span { font-size: 10px !important; }

          /* Labor Hours Tracking Table - Print Optimizations */
          .bg-purple-200.border-b-4 { padding: 0.2rem 0.3rem !important; }
          .bg-purple-200 h2 { font-size: 14px !important; font-weight: bold !important; }

          /* Labor hours table headers - reduce font and padding */
          .bg-purple-100 th { padding: 0.25rem 0.3rem !important; font-size: 12px !important; }

          /* Labor hours table cells - reduce font and padding */
          .border-r-4.border-gray-600 { padding: 0.25rem 0.3rem !important; }
          tbody td.text-xl { font-size: 11px !important; }

          /* Labor hours column widths - optimize space */
          .bg-purple-100 th:nth-child(1),
          tbody tr td:nth-child(1).border-r-4.border-gray-600 { width: 120px !important; max-width: 120px !important; } /* WORK CENTER */

          .bg-purple-100 th:nth-child(2),
          tbody tr td:nth-child(2).border-r-4.border-gray-600 { width: 150px !important; max-width: 150px !important; } /* OPERATOR NAME */

          .bg-purple-100 th:nth-child(3),
          tbody tr td:nth-child(3).border-r-4.border-gray-600 { width: 80px !important; max-width: 80px !important; } /* START TIME */

          .bg-purple-100 th:nth-child(4),
          tbody tr td:nth-child(4).border-r-4.border-gray-600 { width: 80px !important; max-width: 80px !important; } /* END TIME */

          .bg-purple-100 th:nth-child(5),
          tbody tr td:nth-child(5) { width: 80px !important; max-width: 80px !important; } /* TOTAL HOURS */

          /* Labor hours total row */
          .bg-purple-200.border-t-4 td { font-size: 12px !important; padding: 0.3rem !important; }
        }
      `}</style>
      <div className={`mx-auto p-2 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 ${isRmaType(displayTraveler.travelerType) ? 'max-w-full' : 'max-w-7xl'}`}>
        {/* Action Bar - Screen Only */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 no-print bg-white dark:bg-slate-800 shadow-md rounded-lg p-2 sm:p-4">
          <button
            onClick={() => router.push('/travelers')}
            className="flex items-center justify-start space-x-1 sm:space-x-2 px-2 sm:px-4 py-1.5 sm:py-2 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm sm:text-base font-medium"
          >
            <ArrowLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="hidden sm:inline">{createMode ? 'Back to Travelers' : 'Back to Travelers'}</span>
            <span className="sm:hidden">Back</span>
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {createMode ? (
              <>
                <button
                  onClick={handleSaveDraft}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                >
                  <DocumentTextIcon className="h-5 w-5" />
                  <span>Save Draft</span>
                </button>
                <button
                  onClick={handleCreate}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                >
                  <CheckIcon className="h-5 w-5" />
                  <span>Create Traveler</span>
                </button>
              </>
            ) : !isEditing ? (
              <>
                    {lastLoggedStep && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-sm no-print">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Current step
                        </span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">{lastLoggedStep.work_center.replace(/_/g, ' ')}</span>
                        {lastLoggedStep.operators.length > 0 && (
                          <span className="text-xs text-gray-500 dark:text-slate-400">by {lastLoggedStep.operators.join(', ')}</span>
                        )}
                        {lastLoggedStep.hours_worked > 0 && (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{lastLoggedStep.hours_worked.toFixed(2)}h</span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={handlePrint}
                      disabled={!isPrintReady || isPreparingPrint}
                      title={!isPrintReady ? 'Loading barcodes — print will be available shortly' : isPreparingPrint ? 'Preparing print…' : 'Print traveler'}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                    >
                      {isPreparingPrint || !isPrintReady ? (
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                        </svg>
                      ) : (
                        <PrinterIcon className="h-5 w-5" />
                      )}
                      <span>{isPreparingPrint ? 'Preparing…' : !isPrintReady ? 'Loading…' : 'Print'}</span>
                    </button>
                {user?.role !== 'OPERATOR' && (
                  <>
                    <div className="relative">
                      <button
                        onClick={() => setPriorityDropdownOpen(!priorityDropdownOpen)}
                        className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm ${
                          (displayTraveler.priority || 'NORMAL') === 'URGENT' ? 'bg-red-600 hover:bg-red-700 text-white' :
                          (displayTraveler.priority || 'NORMAL') === 'PREMIUM' ? 'bg-orange-500 hover:bg-orange-600 text-white' :
                          (displayTraveler.priority || 'NORMAL') === 'LOW' ? 'bg-gray-500 hover:bg-gray-600 text-white' :
                          'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        <span>{{ 'URGENT': 'Urgent', 'PREMIUM': 'Premium', 'NORMAL': 'Normal', 'LOW': 'Low' }[displayTraveler.priority || 'NORMAL'] || displayTraveler.priority}</span>
                        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {priorityDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-50 min-w-[140px]">
                          {[
                            { value: 'URGENT', label: 'Urgent', bg: 'hover:bg-red-50 text-red-700' },
                            { value: 'PREMIUM', label: 'Premium', bg: 'hover:bg-orange-50 text-orange-700' },
                            { value: 'NORMAL', label: 'Normal', bg: 'hover:bg-indigo-50 text-indigo-700' },
                            { value: 'LOW', label: 'Low', bg: 'hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-slate-400' },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              onClick={async () => {
                                setPriorityDropdownOpen(false);
                                try {
                                  const token = localStorage.getItem('nexus_token') || '';
                                  const res = await fetch(`${API_BASE_URL}/travelers/${travelerId}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                    body: JSON.stringify({ priority: opt.value }),
                                  });
                                  if (res.ok) {
                                    setTraveler(prev => prev ? { ...prev, priority: opt.value } : prev);
                                    setEditedTraveler(prev => prev ? { ...prev, priority: opt.value } : prev);
                                    toast.success(`Priority changed to ${opt.label}`);
                                  }
                                } catch { /* ignore */ }
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm font-semibold ${opt.bg} transition-colors ${
                                displayTraveler.priority === opt.value ? 'bg-gray-100 dark:bg-slate-700' : ''
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Status Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => { setStatusDropdownOpen(!statusDropdownOpen); setPriorityDropdownOpen(false); }}
                        className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm ${
                          displayTraveler.status === 'COMPLETED' ? 'bg-green-600 hover:bg-green-700 text-white' :
                          displayTraveler.status === 'IN_PROGRESS' ? 'bg-purple-600 hover:bg-purple-700 text-white' :
                          displayTraveler.status === 'CREATED' ? 'bg-teal-600 hover:bg-teal-700 text-white' :
                          'bg-amber-600 hover:bg-amber-700 text-white'
                        }`}
                      >
                        <span>{{ 'DRAFT': 'Draft', 'CREATED': 'Awaiting Start', 'IN_PROGRESS': 'In Progress', 'COMPLETED': 'Completed' }[displayTraveler.status] || displayTraveler.status}</span>
                        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {statusDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-50 min-w-[160px]">
                          {[
                            { value: 'DRAFT', label: 'Draft', bg: 'hover:bg-amber-50 text-amber-700' },
                            { value: 'CREATED', label: 'Awaiting Start', bg: 'hover:bg-teal-50 text-teal-700' },
                            { value: 'IN_PROGRESS', label: 'In Progress', bg: 'hover:bg-purple-50 text-purple-700' },
                            { value: 'COMPLETED', label: 'Completed', bg: 'hover:bg-green-50 text-green-700' },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              onClick={async () => {
                                setStatusDropdownOpen(false);
                                try {
                                  const token = localStorage.getItem('nexus_token') || '';
                                  const res = await fetch(`${API_BASE_URL}/travelers/${travelerId}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                    body: JSON.stringify({ status: opt.value }),
                                  });
                                  if (res.ok) {
                                    const payload = await res.json().catch(() => null);
                                    const returnedWO = payload?.traveler?.work_order_number as string | undefined;
                                    const prevStatus = displayTraveler.status;
                                    setTraveler(prev => prev ? { ...prev, status: opt.value, ...(returnedWO ? { workOrder: returnedWO } : {}) } : prev);
                                    setEditedTraveler(prev => prev ? { ...prev, status: opt.value, ...(returnedWO ? { workOrder: returnedWO } : {}) } : prev);
                                    if (prevStatus === 'DRAFT' && opt.value === 'CREATED' && returnedWO) {
                                      toast.success(`Status changed to ${opt.label} — WO ${returnedWO} assigned`);
                                    } else {
                                      toast.success(`Status changed to ${opt.label}`);
                                    }
                                  } else {
                                    toast.error('Failed to update status');
                                  }
                                } catch { toast.error('Failed to update status'); }
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm font-semibold ${opt.bg} transition-colors ${
                                displayTraveler.status === opt.value ? 'bg-gray-100 dark:bg-slate-700' : ''
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleEdit}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                    >
                      <PencilIcon className="h-5 w-5" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => {
                        setConfirmModal({
                          title: 'Delete Traveler',
                          message: `Are you sure you want to delete traveler ${displayTraveler.jobNumber}?`,
                          onConfirm: async () => {
                            setConfirmModal(null);
                            try {
                              const token = localStorage.getItem('nexus_token');
                              const response = await fetch(`${API_BASE_URL}/travelers/${displayTraveler.travelerId}`, {
                                method: 'DELETE',
                                headers: {
                                  'Authorization': `Bearer ${token}`
                                }
                              });
                              if (response.ok) {
                                toast.success(`Traveler ${displayTraveler.jobNumber} deleted!`);
                                router.push('/travelers');
                              } else {
                                toast.error('Failed to delete traveler');
                              }
                            } catch (error) {
                              console.error('Error:', error);
                              toast.error('Failed to delete traveler');
                            }
                          }
                        });
                      }}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                    >
                      <TrashIcon className="h-5 w-5" />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                >
                  <XMarkIcon className="h-5 w-5" />
                  <span>Cancel</span>
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-base font-medium whitespace-nowrap shadow-sm"
                >
                  <CheckIcon className="h-5 w-5" />
                  <span>Save Changes</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Shortage Warning Banner */}
        {!createMode && shortageInfo && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-3 no-print flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              <div>
                <p className="text-sm font-bold text-red-800 dark:text-red-300">
                  {shortageInfo.short} Component Shortage{shortageInfo.short > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {shortageInfo.percent}% kitted ({shortageInfo.total_components - shortageInfo.short} of {shortageInfo.total_components} components ready)
                </p>
              </div>
            </div>
            <a
              href={`/jobs/${encodeURIComponent(traveler?.jobNumber || '')}`}
              className="text-xs font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 px-3 py-1.5 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors whitespace-nowrap"
            >
              View BOM &rarr;
            </a>
          </div>
        )}

        {/* Progress Tracking Section - Above Traveler Form */}
        {!createMode && departmentProgress.length > 0 && (
        <div className="bg-white dark:bg-slate-800 shadow-lg rounded-xl overflow-hidden no-print">
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-white tracking-wide">PROGRESS TRACKING</h2>
              <span className="text-[10px] font-bold text-white bg-white/20 px-2.5 py-0.5 rounded-full">{overallProgress.percent_complete}% Complete</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-white/80 font-medium">
              <span>{overallProgress.completed_steps} of {overallProgress.total_steps} steps</span>
            </div>
          </div>
          <div className="p-4">
            {/* Top Section: Overall Circle + Labor Hours */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-5 mb-5">
              {/* Overall Progress - Centered Circle */}
              <div className="flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 px-6 py-4">
                <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">Overall Progress</div>
                <div className="relative w-24 h-24">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#d1fae5" className="dark:stroke-emerald-900/40" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none"
                      stroke={overallProgress.percent_complete >= 100 ? '#16a34a' : overallProgress.percent_complete >= 75 ? '#059669' : overallProgress.percent_complete >= 50 ? '#0d9488' : overallProgress.percent_complete >= 25 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="2.5" strokeLinecap="round"
                      strokeDasharray={`${overallProgress.percent_complete * 0.9742} 97.42`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 leading-none">{overallProgress.percent_complete}%</span>
                  </div>
                </div>
                <div className="mt-2 text-center">
                  <span className="text-base font-extrabold text-emerald-800 dark:text-emerald-200">{overallProgress.completed_steps}/{overallProgress.total_steps}</span>
                  <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 block font-medium">steps completed</span>
                </div>
                {overallProgress.percent_complete >= 100 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full mt-1.5 border border-green-200 dark:border-green-700">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    All Complete
                  </span>
                )}
              </div>

              {/* Labor Hours - Table Format */}
              <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-b border-gray-200 dark:border-slate-700">
                      <th className="px-3 py-2 text-left text-[10px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Category</th>
                      <th className="px-3 py-2 text-right text-[10px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Hours</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider w-[40%]">Distribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                    {(() => {
                      const grandTotal = Object.values(categoryHours).reduce((sum: number, h: number) => sum + h, 0);
                      const catBarColors: Record<string, string> = {
                        'SMT': '#3b82f6', 'Hand': '#f97316', 'TH': '#a855f7',
                        'AOI': '#06b6d4', 'E-Test': '#eab308', 'Labeling': '#ec4899',
                      };
                      const catDotColors: Record<string, string> = {
                        'SMT': 'bg-blue-500', 'Hand': 'bg-orange-500', 'TH': 'bg-purple-500',
                        'AOI': 'bg-cyan-500', 'E-Test': 'bg-yellow-500', 'Labeling': 'bg-pink-500',
                      };
                      // Only categories this job actually has — the backend sends a
                      // 0.00 entry for every category its steps cover, so a testing
                      // step with no hours yet still lists at 0.00 while a job with
                      // no testing at all omits the row entirely. CATEGORY_ORDER is
                      // display order, not a list of rows to force.
                      const CATEGORY_ORDER = ['SMT', 'Hand', 'TH', 'AOI', 'E-Test', 'Labeling'];
                      const allCats = [
                        ...CATEGORY_ORDER.filter(cat => cat in categoryHours).map(cat => ({ cat, hours: categoryHours[cat] || 0 })),
                        ...Object.entries(categoryHours).filter(([cat]) => !CATEGORY_ORDER.includes(cat)).map(([cat, hours]) => ({ cat, hours })),
                      ];
                      return allCats.map(({ cat, hours }) => {
                        const pct = grandTotal > 0 ? (hours / grandTotal) * 100 : 0;
                        return (
                          <tr key={cat} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${catDotColors[cat] || 'bg-gray-400'}`} />
                                <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{cat}</span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={`text-sm font-bold tabular-nums ${hours > 0 ? 'text-gray-800 dark:text-slate-200' : 'text-gray-300 dark:text-slate-600'}`}>{hours.toFixed(2)}</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                  <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: catBarColors[cat] || '#6b7280' }} />
                                </div>
                                <span className="text-[9px] font-bold text-gray-400 dark:text-slate-500 w-7 text-right tabular-nums">{pct.toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border-t-2 border-emerald-200 dark:border-emerald-700">
                      <td className="px-3 py-2">
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase">Grand Total</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-base font-black text-emerald-700 dark:text-emerald-300 tabular-nums">{Object.values(categoryHours).reduce((sum: number, h: number) => sum + h, 0).toFixed(2)}h</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex-1 bg-emerald-100 dark:bg-emerald-900/30 rounded-full h-2 overflow-hidden">
                          <div className="h-2 rounded-full bg-emerald-500" style={{ width: '100%' }} />
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Department Progress Grid */}
            <div>
              <div className="text-[10px] font-bold text-gray-600 dark:text-slate-400 uppercase tracking-wider mb-2">Department Progress</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {departmentProgress.map((dept) => {
                  const barColor = DEPARTMENT_BAR_COLORS[dept.department] || DEPARTMENT_BAR_COLORS['Other'];
                  const colors = DEPARTMENT_COLORS[dept.department] || DEPARTMENT_COLORS['Other'];
                  const isComplete = dept.percent_complete >= 100;
                  const isNotStarted = dept.completed_steps === 0;
                  return (
                    <div key={dept.department} className={`rounded-xl border p-2.5 text-center transition-all hover:shadow-md hover:-translate-y-0.5 ${
                      isComplete ? 'border-green-300 dark:border-green-700 bg-gradient-to-b from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' :
                      `${colors.border} ${colors.bg}`
                    }`}>
                      <div className={`text-[10px] font-bold mb-1.5 truncate ${isComplete ? 'text-green-700 dark:text-green-400' : colors.text}`}>{dept.department}</div>
                      <div className="relative w-11 h-11 mx-auto">
                        <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3"
                            stroke={isComplete ? '#bbf7d0' : isNotStarted ? '#e5e7eb' : `${barColor}30`}
                            className={isNotStarted ? 'dark:stroke-slate-700' : ''}
                          />
                          <circle cx="18" cy="18" r="15.5" fill="none"
                            stroke={isComplete ? '#16a34a' : isNotStarted ? '#d1d5db' : barColor}
                            strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={`${dept.percent_complete * 0.9742} 97.42`}
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-extrabold" style={{ color: isComplete ? '#16a34a' : isNotStarted ? '#9ca3af' : barColor }}>{dept.percent_complete}%</span>
                      </div>
                      <div className="mt-1">
                        <span className={`text-[10px] font-bold ${isComplete ? 'text-green-700 dark:text-green-400' : isNotStarted ? 'text-gray-400 dark:text-slate-500' : colors.text}`}>{dept.completed_steps}/{dept.total_steps}</span>
                      </div>
                      <span className={`inline-block mt-1 text-[8px] font-bold px-2 py-0.5 rounded-full ${
                        isComplete ? 'bg-green-200 dark:bg-green-900/40 text-green-800 dark:text-green-300' :
                        isNotStarted ? 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-500' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {isComplete ? 'Complete' : isNotStarted ? 'Not Started' : 'In Progress'}
                      </span>

                      {/* Admins can correct a department whose work was done but
                          never clocked. Per-step rather than a typed fraction:
                          "1/3" has to say WHICH step. */}
                      {isAdminUser && (dept.steps?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedDept(expandedDept === dept.department ? null : dept.department)}
                          className="no-print mt-1.5 w-full text-[8px] font-bold text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 underline underline-offset-2"
                        >
                          {expandedDept === dept.department ? 'Close' : 'Edit steps'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Expanded editor, full width under the grid so long operation
                  names stay readable instead of squeezing into a donut tile. */}
              {isAdminUser && expandedDept && (() => {
                const dept = departmentProgress.find(d => d.department === expandedDept);
                if (!dept?.steps?.length) return null;
                return (
                  <div className="no-print mt-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-gray-700 dark:text-slate-200">
                        {dept.department} — mark steps complete
                      </span>
                      <button type="button" onClick={() => setExpandedDept(null)}
                        className="text-[10px] font-bold text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">✕</button>
                    </div>
                    <div className="space-y-1">
                      {dept.steps.map(s => (
                        <label key={s.id}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40 ${savingStepId === s.id ? 'opacity-50' : ''}`}>
                          <input
                            type="checkbox"
                            checked={s.is_completed}
                            disabled={savingStepId === s.id}
                            onChange={(e) => toggleStepCompletion(s.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 w-6 tabular-nums">{s.step_number}</span>
                          <span className="text-[11px] text-gray-800 dark:text-slate-200 flex-1 truncate">{(s.operation || '').replace(/_/g, ' ')}</span>
                          {s.has_labor && (
                            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {formatLaborTime(s.labor_hours || 0)}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-[9px] leading-snug text-gray-400 dark:text-slate-500">
                      A step ticked here is signed with your initials and today&apos;s date on the printed
                      traveler, and logs an audit entry. Steps shared with another department
                      (e.g. Engineering/Prep) update both.
                    </p>
                    {displayTraveler.status === 'COMPLETED' && (
                      <p className="mt-1 text-[9px] leading-snug text-amber-600 dark:text-amber-400">
                        This job is Completed, so the card above already reads 100% — shipping is done.
                        Ticking here won&apos;t change those numbers; it records which steps were actually
                        signed off.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        )}

        {/* Traveler Flow Bar - shows linked travelers navigation */}
        {displayTraveler.groupInfo && displayTraveler.groupInfo.members.length >= 2 && (
          <TravelerFlowBar
            members={displayTraveler.groupInfo.members.map(m => ({
              id: m.id,
              jobNumber: m.jobNumber,
              travelerType: m.travelerType,
              groupSequence: m.groupSequence,
              groupLabel: m.groupLabel,
              quantity: m.quantity,
              status: m.status,
            }))}
            currentTravelerId={displayTraveler.travelerId}
          />
        )}

        {/* Main Traveler Form */}
        <div className={`bg-white dark:bg-slate-800 print:!bg-white shadow-lg border-2 border-black dark:border-slate-600 print:!border-black text-black dark:text-white print:!text-black ${isRmaType(displayTraveler.travelerType) ? 'rma-landscape-print' : ''}`} style={{fontFamily: 'Arial, Helvetica, sans-serif'}}>
          {/* traveler-doc / -header / -body drive the repeating print header: in
              print only, this becomes a table and the header a running header
              group so it redraws atop every page (see @media print). RMA keeps
              its own landscape page1/page2 rules and opts out. */}
          <div className="traveler-doc">
          {/* Both headers sit in the header group: only one renders for a given
              traveler type, and whichever it is repeats on every printed page. */}
          <div className="traveler-doc-header">
          {/* Standard Header Section - hidden for RMA types */}
          {!isRmaType(displayTraveler.travelerType) && (
          <div className="bg-gray-100 dark:bg-slate-900 print:!bg-gray-100 border-b-2 border-black dark:border-slate-600 print:!border-black p-4 print:p-2">
            {/* Mobile Layout - shown below md */}
            <div className="block md:hidden print:hidden mb-4">
              <div className="flex flex-col items-center justify-center mb-4">
                <div className="text-base sm:text-lg font-black mb-2 text-black dark:text-white" style={{fontWeight: '900'}}>
                  {isEditing ? (
                    <div className="flex items-center gap-1 justify-center flex-wrap">
                      <span className="text-sm sm:text-base">Job:</span>
                      <input
                        type="text"
                        value={editData.jobNumber}
                        onChange={(e) => updateField('jobNumber', e.target.value)}
                        className="w-20 sm:w-24 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm sm:text-base font-black text-black dark:text-white"
                      />
                    </div>
                  ) : (
                    <span className="text-base sm:text-lg font-bold">Job: {displayTraveler.jobNumber}</span>
                  )}
                </div>
                <div className="border-2 border-black dark:border-slate-600 p-2 bg-white inline-block rounded">
                  {headerBarcode ? (
                    <img
                      src={`data:image/png;base64,${headerBarcode}`}
                      alt={`Barcode for ${displayTraveler.jobNumber}`}
                      className="mx-auto w-32 h-10 sm:w-40 sm:h-12"
                      style={{ objectFit: 'contain' }}
                      data-print-img="header-barcode" onLoad={handleHeaderBarcodeLoad}
                      onError={() => {
                        console.error('Failed to load header barcode');
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center w-32 h-10 sm:w-40 sm:h-12">
                      <span className="text-xs text-gray-400 dark:text-slate-500">{createMode ? 'Barcode generated after save' : 'Loading barcode...'}</span>
                    </div>
                  )}
                </div>
                {displayTraveler.groupInfo && (
                  <div className="mt-1">
                    <TravelerGroupBadge sequence={displayTraveler.groupInfo.currentSequence} total={displayTraveler.groupInfo.totalCount} label={displayTraveler.groupLabel || undefined} />
                  </div>
                )}
              </div>
              {/* Mobile Info - Organized by Sections */}
              <div className="space-y-3 text-xs">
                {/* Customer Information */}
                <div className="bg-blue-50 border-l-4 border-blue-600 p-2 rounded">
                  <div className="font-bold text-blue-800 mb-1 text-sm">Customer Information</div>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="font-semibold">Code:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerCode} onChange={(e) => updateField('customerCode', e.target.value)} className="w-32 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.customerCode || '-')}</span></div>
                  </div>
                </div>

                {/* Order Information */}
                <div className="bg-green-50 border-l-4 border-green-600 p-2 rounded">
                  <div className="font-bold text-green-800 mb-1 text-sm">Order Information</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1" style={{gridColumn: 'span 2'}}><span className="font-semibold" style={{flexShrink: 0}}>WO:</span> <span className="text-black dark:text-white">{isEditing ? (
                      <span className="flex items-center gap-1">
                        <input type="text" value={workOrderPrefix} onFocus={(e) => e.target.select()} onKeyDown={(e) => { const input = e.target as HTMLInputElement; const hasSelection = input.selectionStart !== input.selectionEnd; if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && workOrderPrefix.length >= 5 && !hasSelection && input.selectionStart === workOrderPrefix.length) { e.preventDefault(); const newSuffix = e.key + workOrderSuffix; setWorkOrderSuffix(newSuffix); updateField('workOrder', workOrderPrefix + '-' + newSuffix); focusSuffixInput(1); } }} onChange={(e) => { const val = e.target.value.slice(0, 5); setWorkOrderPrefix(val); const wo = val && workOrderSuffix ? val + '-' + workOrderSuffix : val || workOrderSuffix; updateField('workOrder', wo); }} className="border border-gray-300 dark:border-slate-600 rounded text-center text-black dark:text-white" style={{width: '90px', padding: '2px 4px', fontFamily: 'monospace', fontSize: '14px'}} placeholder="Prefix" />
                        <span className="text-gray-400 dark:text-slate-500 font-bold">-</span>
                        <input ref={suffixInputRef} type="text" value={workOrderSuffix} onChange={(e) => { setWorkOrderSuffix(e.target.value); const wo = workOrderPrefix && e.target.value ? workOrderPrefix + '-' + e.target.value : workOrderPrefix || e.target.value; updateField('workOrder', wo); }} className="border border-gray-300 dark:border-slate-600 rounded text-sm text-black dark:text-white" style={{width: '75px', padding: '2px 4px'}} placeholder="Suffix" />
                        <button type="button" onClick={() => generateWorkOrder()} disabled={isGeneratingWO} title="Generate next sequential work order number" className="flex-shrink-0 ml-1 px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded border-2 border-blue-700 disabled:cursor-not-allowed shadow">
                          {isGeneratingWO ? '…' : 'Generate'}
                        </button>
                      </span>
                    ) : (displayTraveler.workOrder || '-')}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">PO:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" value={editData.poNumber || ''} onChange={(e) => updateField('poNumber', e.target.value)} className="w-20 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.poNumber || '-')}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">Quantity:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" inputMode="numeric" pattern="[0-9]*" value={editData.quantity === 0 ? '' : editData.quantity} onFocus={(e) => { if (e.target.value === '0') e.target.select(); }} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); updateField('quantity', v === '' ? 0 : parseInt(v)); }} className="w-16 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : displayTraveler.quantity}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">BOM Rev:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" value={editData.revision} onChange={(e) => updateField('revision', e.target.value)} className="w-16 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.revision || '- -')}</span></div>
                  </div>
                </div>

                {/* Part Information */}
                <div className="bg-purple-50 border-l-4 border-purple-600 p-2 rounded">
                  <div className="font-bold text-purple-800 mb-1 text-sm">Part Information</div>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="font-semibold">Part No:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" value={editData.partNumber} onChange={(e) => updateField('partNumber', e.target.value)} className="w-32 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.partNumber || '-')}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">Description:</span> <span className="text-right truncate ml-2 text-black dark:text-white">{isEditing ? <input type="text" value={editData.description} onChange={(e) => updateField('description', e.target.value)} className="w-40 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.description || '-')}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">Cust. Rev:</span> <span className="text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerRevision || ''} onChange={(e) => updateField('customerRevision', e.target.value)} className="w-20 border border-gray-300 dark:border-slate-600 rounded px-1 text-black dark:text-white"/> : (displayTraveler.customerRevision || '- -')}</span></div>
                  </div>
                </div>

                {/* Important Dates */}
                <div className="bg-orange-50 border-l-4 border-orange-600 p-2 rounded">
                  <div className="font-bold text-orange-800 mb-1 text-sm">Important Dates</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex justify-between"><span className="font-semibold">Start:</span> <span className="text-black dark:text-white">{isEditing ? <><input type="date" value={editData.createdAt} onChange={(e) => updateField('createdAt', e.target.value)} className="w-28 border border-gray-300 dark:border-slate-600 rounded px-1 text-[10px] screen-only text-black dark:text-white"/><span className="print-only">{formatDateDisplay(editData.createdAt) || '-'}</span></> : (formatDateDisplay(displayTraveler.createdAt) || '-')}</span></div>
                    <div className="flex justify-between"><span className="font-semibold">Ship Date:</span> <span className="text-black dark:text-white">{isEditing ? <><input type="date" value={editData.shipDate} onChange={(e) => updateField('shipDate', e.target.value)} className="w-28 border border-gray-300 dark:border-slate-600 rounded px-1 text-[10px] screen-only text-black dark:text-white"/><span className="print-only">{formatDateDisplay(editData.shipDate) || '-'}</span></> : (formatDateDisplay(displayTraveler.shipDate) || '-')}</span></div>
                    <div className="col-span-2 flex justify-between"><span className="font-semibold">Due:</span> <span className="text-black dark:text-white">{isEditing ? <><input type="date" value={editData.dueDate} onChange={(e) => updateField('dueDate', e.target.value)} className="w-28 border border-gray-300 dark:border-slate-600 rounded px-1 text-[10px] screen-only text-black dark:text-white"/><span className="print-only">{formatDateDisplay(editData.dueDate) || '-'}</span></> : (formatDateDisplay(displayTraveler.dueDate) || '-')}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop & Print Layout - hidden on mobile, shown md+ */}
            <div className="hidden md:grid md:grid-cols-3 gap-2 print:!grid print:!grid-cols-3 print:gap-2 items-center">
              {/* Left Column */}
              <div className="space-y-0.5 print:space-y-0.5 flex flex-col items-start min-w-0">
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">Cust. Code:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.customerCode}
                      onChange={(e) => updateField('customerCode', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm max-w-full text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-base print:text-[8px] print:leading-tight overflow-hidden text-black dark:text-white">{displayTraveler.customerCode || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">Work Order:</span>
                  {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0 max-w-full flex-wrap sm:flex-nowrap">
                        <input
                          type="text"
                          value={workOrderPrefix}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            const input = e.target as HTMLInputElement;
                            const hasSelection = input.selectionStart !== input.selectionEnd;
                            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && workOrderPrefix.length >= 5 && !hasSelection && input.selectionStart === workOrderPrefix.length) {
                              e.preventDefault();
                              const newSuffix = e.key + workOrderSuffix;
                              setWorkOrderSuffix(newSuffix);
                              updateField('workOrder', workOrderPrefix + '-' + newSuffix);
                              focusSuffixInput(1);
                            }
                          }}
                          onChange={(e) => {
                            const val = e.target.value.slice(0, 5);
                            setWorkOrderPrefix(val);
                            const wo = val && workOrderSuffix ? val + '-' + workOrderSuffix : val || workOrderSuffix;
                            updateField('workOrder', wo);
                          }}
                          className="w-20 sm:w-[90px] min-w-0 border border-gray-300 dark:border-slate-600 rounded text-center text-black dark:text-white"
                          style={{padding: '2px 4px', fontFamily: 'monospace', fontSize: '14px'}}
                          placeholder="Prefix"
                        />
                        <span className="text-gray-400 dark:text-slate-500 text-xs flex-shrink-0">-</span>
                        <input
                          ref={suffixInputRef2}
                          type="text"
                          value={workOrderSuffix}
                          onChange={(e) => {
                            setWorkOrderSuffix(e.target.value);
                            const wo = workOrderPrefix && e.target.value ? workOrderPrefix + '-' + e.target.value : workOrderPrefix || e.target.value;
                            updateField('workOrder', wo);
                          }}
                          className="w-16 sm:w-24 min-w-0 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-black dark:text-white"
                          placeholder="Suffix"
                        />
                        <button
                          type="button"
                          onClick={() => generateWorkOrder()}
                          disabled={isGeneratingWO}
                          title="Generate next sequential work order number"
                          className="flex-shrink-0 ml-1 px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded border-2 border-blue-700 disabled:cursor-not-allowed shadow no-print"
                        >
                          {isGeneratingWO ? '…' : 'Generate'}
                        </button>
                      </div>
                  ) : (
                    <span className="flex-1 text-left text-base print:text-[8px] print:leading-tight text-black dark:text-white">{displayTraveler.workOrder || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">Quantity:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={editData.quantity === 0 ? '' : editData.quantity}
                      onFocus={(e) => { if (e.target.value === '0') e.target.select(); }}
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); updateField('quantity', v === '' ? 0 : parseInt(v)); }}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm text-left max-w-full text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-left text-base print:text-[8px] print:leading-tight text-black dark:text-white">{displayTraveler.quantity}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">PO Number:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.poNumber || ''}
                      onChange={(e) => updateField('poNumber', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm text-left max-w-full text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-left text-base print:text-[8px] print:leading-tight text-black dark:text-white">{displayTraveler.poNumber || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">Part No:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.partNumber}
                      onChange={(e) => updateField('partNumber', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm text-left max-w-full text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-left text-base print:text-[8px] print:leading-tight text-black dark:text-white">{displayTraveler.partNumber || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 print:gap-0.5 w-full min-w-0">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight flex-shrink-0 text-black dark:text-white">Invoice No:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.invoiceNumber || ''}
                      onChange={(e) => updateField('invoiceNumber', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm text-left max-w-full text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-left text-base print:text-[8px] print:leading-tight text-black dark:text-white">{displayTraveler.invoiceNumber || <span className="inline-block min-w-[120px] print:min-w-[80px] border-b border-black dark:border-slate-400 align-bottom">&nbsp;</span>}</span>
                  )}
                </div>
              </div>

              {/* Center - Barcode with Details */}
              <div className="flex flex-col items-center justify-center justify-self-center">
                <div className="text-center">
                  <div className="text-xl font-black mb-2 print:mb-0 print:text-[10px] print:leading-tight text-black dark:text-white" style={{fontWeight: '900'}}>
                    {isEditing ? (
                      <div className="flex items-center gap-1 justify-center flex-wrap">
                        <span className="text-lg">Job:</span>
                        <input
                          type="text"
                          value={editData.jobNumber}
                          onChange={(e) => updateField('jobNumber', e.target.value)}
                          className="w-32 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-lg font-black text-black dark:text-white"
                        />
                      </div>
                    ) : (
                      <span className="text-xl font-bold print:text-[10px]">Job: {displayTraveler.jobNumber}</span>
                    )}
                  </div>
                  <div className="border-2 border-black dark:border-slate-600 bg-white inline-block rounded" style={{ padding: '2px 4px' }}>
                    {headerBarcode ? (
                      <img
                        src={`data:image/png;base64,${headerBarcode}`}
                        alt={`Barcode for ${displayTraveler.jobNumber}`}
                        className="h-14"
                        style={{ width: 'auto', maxWidth: '100%', imageRendering: 'pixelated' }}
                        data-print-img="header-barcode" onLoad={handleHeaderBarcodeLoad}
                        onError={() => {
                          console.error('Failed to load header barcode');
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center w-44 h-14">
                        <span className="text-xs text-gray-400 dark:text-slate-500">{createMode ? 'Barcode generated after save' : 'Loading barcode...'}</span>
                      </div>
                    )}
                  </div>
                  {displayTraveler.groupInfo && (
                    <div className="mt-1 print:mt-0.5">
                      <TravelerGroupBadge sequence={displayTraveler.groupInfo.currentSequence} total={displayTraveler.groupInfo.totalCount} label={displayTraveler.groupLabel || undefined} />
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-0.5 print:space-y-0.5 flex flex-col items-end">
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Description:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-right text-xs print:text-[8px] break-words text-black dark:text-white">{displayTraveler.description || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">BOM Rev:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.revision}
                      onChange={(e) => updateField('revision', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right text-black dark:text-white"
                    />
                  ) : (
                    <span className="flex-1 text-right text-sm print:text-[8px] print:leading-tight text-black dark:text-white">
                      {displayTraveler.revision ? displayTraveler.revision : '- -'}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Cust. Rev:</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.customerRevision || ''}
                      onChange={(e) => updateField('customerRevision', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right text-black dark:text-white"
                      placeholder="Cust. Revision"
                    />
                  ) : (
                    <span className="flex-1 text-right text-sm print:text-[8px] print:leading-tight text-black dark:text-white">
                      {displayTraveler.customerRevision ? displayTraveler.customerRevision : '- -'}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Start Date:</span>
                  {isEditing ? (
                    <>
                      <input
                        type="date"
                        value={editData.createdAt}
                        onChange={(e) => updateField('createdAt', e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right screen-only text-black dark:text-white"
                      />
                      <span className="print-only flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(editData.createdAt) || '-'}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(displayTraveler.createdAt) || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Ship Date:</span>
                  {isEditing ? (
                    <>
                      <input
                        type="date"
                        value={editData.shipDate}
                        onChange={(e) => updateField('shipDate', e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right screen-only text-black dark:text-white"
                      />
                      <span className="print-only flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(editData.shipDate) || '-'}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(displayTraveler.shipDate) || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1 ">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Due Date:</span>
                  {isEditing ? (
                    <>
                      <input
                        type="date"
                        value={editData.dueDate}
                        onChange={(e) => updateField('dueDate', e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs text-right screen-only text-black dark:text-white"
                      />
                      <span className="print-only flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(editData.dueDate) || '-'}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-right text-xs whitespace-nowrap print:text-[8px] print:leading-tight text-black dark:text-white">{formatDateDisplay(displayTraveler.dueDate) || '-'}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 print:gap-1">
                  <span className="font-bold text-sm min-w-[80px] print:text-[8px] print:min-w-[70px] print:leading-tight text-black dark:text-white">Priority:</span>
                  {isEditing ? (
                    <>
                      <select
                        value={editData.priority || 'NORMAL'}
                        onChange={(e) => updateField('priority', e.target.value)}
                        className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs font-bold screen-only text-black dark:text-white"
                      >
                        <option value="NORMAL">Normal</option>
                        <option value="PREMIUM">Premium</option>
                        <option value="URGENT">Urgent</option>
                        <option value="LOW">Low</option>
                      </select>
                      <span className="print-only flex-1 text-right text-sm font-bold print:text-[8px] print:leading-tight text-black dark:text-white">{{ 'URGENT': 'Urgent', 'PREMIUM': 'Premium', 'NORMAL': 'Normal', 'LOW': 'Low' }[editData.priority || 'NORMAL'] || editData.priority}</span>
                    </>
                  ) : (
                    <span className={`flex-1 text-right text-sm font-bold print:text-[8px] print:leading-tight ${
                      (displayTraveler.priority || 'NORMAL') === 'URGENT' ? 'text-red-700' :
                      (displayTraveler.priority || 'NORMAL') === 'PREMIUM' ? 'text-orange-700' :
                      (displayTraveler.priority || 'NORMAL') === 'LOW' ? 'text-gray-500 dark:text-slate-400' :
                      'text-indigo-700'
                    }`}>{{ 'URGENT': 'Urgent', 'PREMIUM': 'Premium', 'NORMAL': 'Normal', 'LOW': 'Low' }[displayTraveler.priority || 'NORMAL'] || displayTraveler.priority}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* RMA Header - Word Document Layout */}
          {isRmaType(displayTraveler.travelerType) && (() => {
            const rmaLabel = displayTraveler.travelerType === 'MODIFICATION'
              ? (displayTraveler.woTypeLabel || 'Modification')
              : 'RMA';
            // Short prefix for the top-left "<rma> ___ JOB NO <job>" line. Display
            // only — the labor-tracking/travelers-list label keeps "RMA JOB NO" as
            // its parser marker, so this must not feed those code paths.
            const jobNoPrefix = displayTraveler.travelerType === 'MODIFICATION' ? 'MOD' : 'RMA';
            // "MODIFICATION"/"REWORK" are far wider than "RMA"; shrink the center
            // routing title for long labels so it can't overflow its cell and crash
            // into the To Stock / From Stock / Ship VIA column on the right.
            const isLongRoutingLabel = rmaLabel.length > 4;
            return (
          <div className="border-b-2 border-black dark:border-slate-600 print:break-inside-avoid">
            {/* Top banner: RMA ROUTING | RMA Job No. + Barcode | To Stock / From Stock / Ship VIA */}
            <div className="bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800 print:!bg-gray-100 border-b-2 border-black dark:border-slate-600">
              <table className="w-full border-collapse rma-header-banner" style={{tableLayout: 'fixed'}}>
                <tbody>
                  <tr>
                    {/* Left: RMA ROUTING title */}
                    <td className="border-r-2 border-black dark:border-slate-600 px-4 py-3 print:px-4 print:py-3 text-center align-middle overflow-hidden" style={{width: '30%'}}>
                      <div className={`font-black text-black dark:text-white leading-tight ${isLongRoutingLabel ? 'text-lg print:text-[18px] tracking-tight' : 'text-2xl print:text-[26px] tracking-wider'}`} style={{fontWeight: '900'}}>{rmaLabel.toUpperCase()}</div>
                      <div className="text-lg font-bold text-black dark:text-white print:text-[18px] tracking-widest">ROUTING</div>
                    </td>
                    {/* Center: Job No + Barcode */}
                    <td className="border-r-2 border-black dark:border-slate-600 px-4 py-3 print:px-4 print:py-3 align-middle" style={{width: '40%'}}>
                      <div className="flex flex-col gap-2 items-center text-center w-full">
                        <div>
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <input type="text" value={editData.rmaNumber || ''} onChange={(e) => updateField('rmaNumber', e.target.value)} className="w-20 border-2 border-gray-400 dark:border-slate-500 rounded px-2 py-1 text-base font-black text-black dark:text-white" placeholder="RMA #" />
                              <span className="text-sm font-black text-black dark:text-white">{jobNoPrefix} JOB NO</span>
                              <input type="text" value={editData.jobNumber} onChange={(e) => updateField('jobNumber', e.target.value)} className="w-28 border-2 border-gray-400 dark:border-slate-500 rounded px-2 py-1 text-base font-black text-black dark:text-white" placeholder="Job #" />
                            </div>
                          ) : (
                            <div className="text-base font-black text-black dark:text-white print:text-[18px] break-words leading-tight text-center" style={{fontWeight: '900', letterSpacing: '0.5px'}}>
                              {`${displayTraveler.rmaNumber || ''} ${jobNoPrefix} JOB NO ${displayTraveler.jobNumber || ''}`.trim()}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-center gap-3 w-full">
                          <div className="border-2 border-black dark:border-slate-600 bg-white rounded min-w-0" style={{padding: '2px 4px'}}>
                            {headerBarcode ? (
                              <img src={`data:image/png;base64,${headerBarcode}`} alt={`Barcode`} className="h-14 max-w-full" style={{ width: 'auto', maxWidth: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} data-print-img="header-barcode" onLoad={handleHeaderBarcodeLoad} />
                            ) : (
                              <div className="flex items-center justify-center h-14 print:h-28" style={{width: '160px'}}>
                                <span className="text-[10px] text-gray-400">{createMode ? 'Barcode after save' : 'Loading...'}</span>
                              </div>
                            )}
                          </div>
                          {displayTraveler.groupInfo && (
                            <div className="mt-1 print:mt-0.5">
                              <TravelerGroupBadge sequence={displayTraveler.groupInfo.currentSequence} total={displayTraveler.groupInfo.totalCount} label={displayTraveler.groupLabel || undefined} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Right: To Stock / From Stock / Ship VIA */}
                    <td className="px-4 py-3 print:px-4 print:py-3 align-middle text-sm print:text-[13px]" style={{width: '30%'}}>
                      <div className="space-y-1.5 print:space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-black dark:text-white min-w-[85px] print:min-w-[65px]">To Stock:</span>
                          {isEditing ? <input type="text" value={editData.toStock} onChange={(e) => updateField('toStock', e.target.value)} className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : <span className="flex-1 border-b border-gray-300 dark:border-slate-600 min-h-[20px] text-black dark:text-white">{displayTraveler.toStock || ''}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-black dark:text-white min-w-[85px] print:min-w-[65px]">From Stock:</span>
                          {isEditing ? <input type="text" value={editData.fromStock} onChange={(e) => updateField('fromStock', e.target.value)} className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : <span className="flex-1 border-b border-gray-300 dark:border-slate-600 min-h-[20px] text-black dark:text-white">{displayTraveler.fromStock || ''}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-black dark:text-white min-w-[85px] print:min-w-[65px]">Ship VIA:</span>
                          {isEditing ? <input type="text" value={editData.shipVia} onChange={(e) => updateField('shipVia', e.target.value)} className="flex-1 border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : <span className="flex-1 border-b border-gray-300 dark:border-slate-600 min-h-[20px] text-black dark:text-white">{displayTraveler.shipVia || ''}</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* RMA Details - proper 4-column table: Label | Value | Label | Value */}
            <div className="bg-gray-100 dark:bg-slate-900 print:!bg-gray-100 border-b-2 border-black dark:border-slate-600">
              <table className="w-full border-collapse text-sm print:text-[13px] rma-header-table">
                <colgroup>
                  <col style={{width: '18%'}} />
                  <col style={{width: '32%'}} />
                  <col style={{width: '18%'}} />
                  <col style={{width: '32%'}} />
                </colgroup>
                <tbody>
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Code:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerCode} onChange={(e) => updateField('customerCode', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.customerCode || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Part Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="text" value={editData.partNumber} onChange={(e) => updateField('partNumber', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.partNumber || '-')}</td>
                  </tr>
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Contact:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerContact || ''} onChange={(e) => updateField('customerContact', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.customerContact || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Part No. Desc:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="text" value={editData.description || ''} onChange={(e) => updateField('description', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.description || '-')}</td>
                  </tr>
                  {displayTraveler.travelerType === 'RMA_SAME' && (
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Original WO Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.originalWoNumber || ''} onChange={(e) => updateField('originalWoNumber', e.target.value)} onBlur={(e) => autofillFromOriginalWo(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.originalWoNumber || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Original Built Quantity:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="number" value={editData.originalBuiltQuantity || ''} onChange={(e) => updateField('originalBuiltQuantity', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.originalBuiltQuantity || '-')}</td>
                  </tr>
                  )}
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Work Order Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{displayTraveler.travelerType === 'MODIFICATION' ? (
                      isEditing ? (
                        <select
                          value={editedTraveler?.woTypeLabel || 'Modification'}
                          onChange={(e) => updateField('woTypeLabel', e.target.value)}
                          className="font-bold text-red-700 dark:text-red-400 mr-1 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-sm bg-white dark:bg-slate-800"
                        >
                          <option value="Modification">Modification</option>
                          <option value="Rework">Rework</option>
                        </select>
                      ) : (
                        <span className="font-bold text-red-700 dark:text-red-400 mr-1">{displayTraveler.woTypeLabel || 'Modification'}</span>
                      )
                    ) : (
                      <span className="font-bold text-red-700 dark:text-red-400 mr-1">RMA</span>
                    )}{isEditing ? (<span className="inline-flex items-center gap-1"><input type="text" value={workOrderPrefix} onFocus={(e) => e.target.select()} onKeyDown={(e) => { const input = e.target as HTMLInputElement; const hasSelection = input.selectionStart !== input.selectionEnd; if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && workOrderPrefix.length >= 5 && !hasSelection && input.selectionStart === workOrderPrefix.length) { e.preventDefault(); const newSuffix = e.key + workOrderSuffix; setWorkOrderSuffix(newSuffix); updateField('workOrder' as keyof Traveler, workOrderPrefix + '-' + newSuffix); focusSuffixInput(1); } }} onChange={(e) => { const val = e.target.value.slice(0, 5); setWorkOrderPrefix(val); const wo = val && workOrderSuffix ? val + '-' + workOrderSuffix : val; updateField('workOrder' as keyof Traveler, wo); }} className="w-20 border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm font-mono text-black dark:text-white" /><span className="text-gray-400">-</span><input ref={suffixInputRef} type="text" value={workOrderSuffix} onChange={(e) => { setWorkOrderSuffix(e.target.value); const wo = workOrderPrefix && e.target.value ? workOrderPrefix + '-' + e.target.value : workOrderPrefix; updateField('workOrder' as keyof Traveler, wo); }} className="w-16 border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" placeholder="Suffix" /><button type="button" onClick={() => generateWorkOrder()} disabled={isGeneratingWO} title="Generate next sequential work order number" className="flex-shrink-0 ml-1 px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded border-2 border-blue-700 disabled:cursor-not-allowed shadow no-print">{isGeneratingWO ? '…' : 'Generate'}</button></span>) : (displayTraveler.workOrder || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">{displayTraveler.travelerType === 'RMA_SAME' ? 'Number of units shipped:' : `Quantity ${rmaLabel} issued for:`}</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{displayTraveler.travelerType === 'RMA_SAME' ? (isEditing ? <input type="number" value={editData.unitsShipped || ''} onChange={(e) => updateField('unitsShipped', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.unitsShipped || '-')) : (isEditing ? <input type="number" value={editData.quantityRmaIssued || ''} onChange={(e) => updateField('quantityRmaIssued', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.quantityRmaIssued || '-'))}</td>
                  </tr>
                  {displayTraveler.travelerType === 'RMA_SAME' && (
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Original PO Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.originalPoNumber || ''} onChange={(e) => updateField('originalPoNumber', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.originalPoNumber || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Quantity {rmaLabel} issued for:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="number" value={editData.quantityRmaIssued || ''} onChange={(e) => updateField('quantityRmaIssued', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.quantityRmaIssued || '-')}</td>
                  </tr>
                  )}
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">{rmaLabel} Traveler Issued on:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <><input type="date" value={editData.createdAt} onChange={(e) => updateField('createdAt', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm screen-only text-black dark:text-white" /><span className="print-only">{formatDateDisplay(editData.createdAt)}</span></> : (formatDateDisplay(displayTraveler.createdAt) || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">{rmaLabel} Traveler Due Date:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <><input type="date" value={editData.dueDate} onChange={(e) => updateField('dueDate', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm screen-only text-black dark:text-white" /><span className="print-only">{formatDateDisplay(editData.dueDate) || 'NA'}</span></> : (formatDateDisplay(displayTraveler.dueDate) || 'NA')}</td>
                  </tr>
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Return PO Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.returnPoNumber || ''} onChange={(e) => updateField('returnPoNumber', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.returnPoNumber || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Units Received:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="number" value={editData.unitsReceived || ''} onChange={(e) => updateField('unitsReceived', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.unitsReceived || '-')}</td>
                  </tr>
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">{rmaLabel} PO Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.rmaPoNumber || ''} onChange={(e) => updateField('rmaPoNumber', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.rmaPoNumber || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">{rmaLabel} Priority:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <select value={editData.priority || 'NORMAL'} onChange={(e) => updateField('priority', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white bg-white dark:bg-slate-700"><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select> : <span className={`font-bold ${displayTraveler.priority === 'URGENT' ? 'text-red-700' : displayTraveler.priority === 'HIGH' ? 'text-orange-700' : ''}`}>{displayTraveler.priority === 'HIGH' ? 'High' : displayTraveler.priority === 'URGENT' ? 'Urgent' : 'Normal'}</span>}</td>
                  </tr>
                  <tr className="border-b border-gray-300 dark:border-slate-600">
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer NCR#:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerNcr || ''} onChange={(e) => updateField('customerNcr', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.customerNcr || '-')}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Revision sent:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerRevisionSent || ''} onChange={(e) => updateField('customerRevisionSent', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.customerRevisionSent || '-')}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Invoice Number:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 border-r border-gray-300 dark:border-slate-600 text-black dark:text-white">{isEditing ? <input type="text" value={editData.invoiceNumber || ''} onChange={(e) => updateField('invoiceNumber', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.invoiceNumber || <span className="inline-block min-w-[140px] border-b border-black dark:border-slate-400 align-bottom">&nbsp;</span>)}</td>
                    <td className="px-3 py-1.5 print:px-2 print:py-0.5 font-bold text-black dark:text-white whitespace-nowrap">Customer Revision Received:</td>
                    <td className="px-2 py-1.5 print:px-1 print:py-0.5 text-black dark:text-white">{isEditing ? <input type="text" value={editData.customerRevisionReceived || ''} onChange={(e) => updateField('customerRevisionReceived', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-0.5 text-sm text-black dark:text-white" /> : (displayTraveler.customerRevisionReceived || '-')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          );
          })()}
          </div>{/* /traveler-doc-header */}

          {/* Everything below the headers is the repeating table body group. */}
          <div className="traveler-doc-body">

          {/* Specifications Section */}
          <div className="border-b border-black dark:border-slate-600 print:break-inside-avoid">
            <div className="bg-yellow-200 dark:bg-yellow-900/50 border-b border-black dark:border-slate-600 px-2 py-0.5 flex justify-between items-center print:px-1 print:py-0 print:!bg-yellow-200">
              <h2 className="font-bold text-xs text-yellow-900 dark:text-yellow-200 print:!text-black print:text-[9px]">SPECIFICATIONS</h2>
              {isEditing && (
                <button
                  onClick={addSpecification}
                  className="flex items-center space-x-1 px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs no-print"
                >
                  <PlusIcon className="h-3 w-3" />
                  <span>Add Specification</span>
                </button>
              )}
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-0.5 text-xs print:p-0 print:text-[8px]">
              {isEditing ? (
                <div className="space-y-2">
                  {editData.specs.map((spec) => (
                    <div key={spec.id} className="flex items-start space-x-2 border-b border-green-200 pb-2">
                      <textarea
                        value={spec.text}
                        onChange={(e) => updateSpecification(spec.id, 'text', e.target.value)}
                        className="flex-1 p-1 border border-gray-300 dark:border-slate-600 rounded min-h-[40px] text-xs screen-only"
                        placeholder="Enter specification..."
                      />
                      <div className="print-only whitespace-pre-wrap flex-1 text-xs text-black dark:text-white">{spec.text || '-'}</div>
                      <input
                        type="date"
                        value={spec.date}
                        onChange={(e) => updateSpecification(spec.id, 'date', e.target.value)}
                        className="w-32 border border-gray-300 dark:border-slate-600 rounded px-1 py-0.5 text-xs screen-only"
                      />
                      <span className="print-only font-bold text-xs text-black dark:text-white">{formatDateDisplay(spec.date) || '-'}</span>
                      <button
                        onClick={() => removeSpecification(spec.id)}
                        className="p-0.5 bg-red-600 hover:bg-red-700 text-white rounded no-print"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {editData.specs.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-slate-400">No specifications yet. Click &quot;Add Specification&quot; to create one.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {displayTraveler.specs.map((spec) => (
                    <div key={spec.id} className="flex justify-between pb-0.5">
                      <div className="whitespace-pre-wrap flex-1 text-xs text-black dark:text-white">{spec.text || '-'}</div>
                      <div className="font-bold ml-2 text-xs text-black dark:text-white">{spec.date}</div>
                    </div>
                  ))}
                  {displayTraveler.specs.length === 0 && (
                    <div className="text-gray-500 dark:text-slate-400 text-xs">No specifications</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Routing Section — must NOT be break-inside:avoid. The step table is
              taller than a page, so the browser abandons the constraint and
              breaks after the first child, stranding the ROUTING title at the
              foot of one page with the table on the next. Let it flow; the CSS
              keeps the title glued to the table and repeats the header row. */}
          <div className="routing-section border-b-2 border-black dark:border-slate-600">
            <div className="bg-blue-200 dark:bg-blue-900/50 border-b border-black dark:border-slate-600 px-2 py-0.5 flex justify-between items-center print:px-1 print:py-0 print:!bg-blue-200">
              <h2 className="font-bold text-xs text-blue-900 dark:text-blue-200 print:!text-black print:text-[9px]">ROUTING</h2>
              {isEditing && (
                <button
                  onClick={addStep}
                  className="flex items-center space-x-1 px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs no-print"
                >
                  <PlusIcon className="h-3 w-3" />
                  <span>Add Step</span>
                </button>
              )}
            </div>

            {/* Current step is deliberately screen-only: the paper traveler is
                the routing record and shouldn't carry live progress. The badge
                stays in the on-screen header. */}

            {/* Desktop Table View */}
            <div className="routing-table-wrap overflow-x-auto print:overflow-x-visible">
            <table className={`routing-table routing-table-desktop w-full border-collapse text-sm border-2 border-gray-400 dark:border-slate-500 min-w-[640px] ${isEditing ? 'editing-mode' : ''}`} style={{tableLayout: isEditing ? 'fixed' : 'auto'}}>
              <thead>
                <tr className="bg-gray-200 dark:bg-slate-700 border-b-2 border-gray-400 dark:border-slate-500">
                  {isEditing && <th className="border-r-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center font-bold text-xs no-print" style={{width: '30px'}}></th>}
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 w-12 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]">SQ</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 px-1 py-1 text-left font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '200px' : '160px'}}>WORK CENTER</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 px-1 py-1 text-left font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '170px' : '240px'}}>INSTRUCTIONS</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '65px' : '60px'}}>TIME</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '60px' : '55px'}}>QTY</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '60px' : '55px'}}>REJ</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '60px' : '55px'}}>ACC</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '70px' : '65px'}}>SIGN</th>
                  <th className="border-r-2 border-gray-400 dark:border-slate-500 py-1 text-center font-bold text-sm print:px-1 print:py-1 print:text-[10px]" style={{width: isEditing ? '55px' : '65px'}}>DATE</th>
                </tr>
              </thead>
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayTraveler.steps.map(s => String(s.id ?? s.seq))} strategy={verticalListSortingStrategy}>
              <tbody>
                {displayTraveler.steps.map((step, index) => {
                  const stepDndId = String(step.id ?? step.seq);
                  const so = signoffOf(step);
                  return isEditing ? (
                  <SortableTableRow key={stepDndId} id={stepDndId}>
                    {({ dragHandleProps, style, ref }) => (
                  <tr
                    ref={(el) => {
                      ref(el);
                      stepRowRefs.current[index] = el;
                    }}
                    style={style}
                    className="border-b border-gray-300 dark:border-slate-600 transition-colors duration-300"
                  >
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0 text-center bg-gray-50 dark:bg-slate-900 no-print">
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              {...dragHandleProps}
                              className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-400 touch-none"
                              title="Drag to reorder"
                            >
                              <Bars3Icon className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => removeStep(index)}
                              className="p-0.5 bg-red-600 hover:bg-red-700 text-white rounded"
                              title="Remove step"
                            >
                              <TrashIcon className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0 text-center bg-yellow-50 dark:bg-yellow-900/20">
                          <input
                            type="number"
                            min="1"
                            value={step.seq}
                            onChange={(e) => updateStep(index, 'seq', parseInt(e.target.value) || 0)}
                            className="w-14 border border-yellow-500 rounded text-center text-sm font-bold bg-white dark:bg-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none screen-only"
                            style={{padding: '2px 2px'}}
                          />
                          <span className="print-only font-bold" style={{fontSize: '10px'}}>{step.seq}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <div className="flex flex-row items-center justify-between gap-1">
                            <div className="flex-1">
                              <select
                                value={step.workCenter}
                                onChange={(e) => updateStep(index, 'workCenter', e.target.value)}
                                className="block w-full border-2 border-blue-400 rounded-lg px-1 font-medium hover:border-blue-500 focus:border-blue-600 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-800 cursor-pointer screen-only"
                                style={{
                                  minHeight: '20px',
                                  fontSize: '12px',
                                  lineHeight: '1',
                                  paddingTop: '1px',
                                  paddingBottom: '1px',
                                  width: '100%',
                                  maxWidth: '100%',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden'
                                }}
                              >
                                <option value="" style={{ fontSize: '13px' }}>Select Work Center...</option>
                                {dynamicWorkCenters.map(wc => (
                                  <option key={wc.name} value={wc.name} title={wc.description} style={{ fontSize: '13px' }}>{wc.name}</option>
                                ))}
                              </select>
                              <span className="print-only font-semibold break-words" style={{fontSize: '10px'}}>{step.workCenter.replace(/_/g, ' ')}</span>
                            </div>
                            {step.id && stepQRCodes[step.id] && (
                              <img
                                src={`data:image/png;base64,${stepQRCodes[step.id]}`}
                                alt={`QR Code for ${step.workCenter}`}
                                className="border border-gray-200 dark:border-gray-600 flex-shrink-0 rounded bg-white"
                                style={{ width: '70px', height: '70px', padding: '1px' }}
                                data-print-img="step-qr" data-step-id={step.id} onLoad={() => handleStepQRLoad(step.id!)}
                                onError={() => {
                                  console.error('Failed to load QR code for step', step.id);
                                }}
                              />
                            )}
                          </div>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0" style={{minWidth: '120px'}}>
                          <textarea
                            value={step.instruction}
                            onChange={(e) => updateStep(index, 'instruction', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded text-xs screen-only"
                            style={{padding: '1px 3px', minHeight: '18px', lineHeight: '1.2', resize: 'vertical'}}
                            placeholder="Enter instructions..."
                            rows={1}
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{fontSize: '9px', minHeight: '16px'}}><span className="inline-block align-middle mr-1 border border-gray-600" style={{width: '11px', height: '11px'}} />{step.instruction || '\u00A0'}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <input
                            type="text"
                            value={step.completedTime || ''}
                            onChange={(e) => updateStep(index, 'completedTime', e.target.value)}
                            className="w-full border-b-2 border-gray-400 dark:border-slate-500 text-xs text-center bg-transparent screen-only"
                            style={{padding: '1px 2px'}}
                            placeholder="Hrs"
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[10px] font-bold" style={{minHeight: '16px'}}>{so.time || '\u00A0'}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <input
                            type="text"
                            value={step.quantity}
                            onChange={(e) => updateStep(index, 'quantity', e.target.value)}
                            className="w-full border-b-2 border-gray-400 dark:border-slate-500 text-center text-sm font-bold bg-transparent screen-only"
                            style={{padding: '1px 2px'}}
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[10px] font-bold" style={{minHeight: '16px'}}>{step.quantity || '\u00A0'}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <input
                            type="text"
                            value={step.rejected}
                            onChange={(e) => updateStep(index, 'rejected', e.target.value)}
                            className="w-full border-b-2 border-red-400 text-center text-sm font-bold text-red-700 bg-transparent screen-only"
                            style={{padding: '1px 2px'}}
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[10px] font-bold text-red-700" style={{minHeight: '16px'}}>{step.rejected || '\u00A0'}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <input
                            type="text"
                            value={step.accepted}
                            onChange={(e) => updateStep(index, 'accepted', e.target.value)}
                            className="w-full border-b-2 border-green-400 text-center text-sm font-bold text-green-700 bg-transparent screen-only"
                            style={{padding: '1px 2px'}}
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[10px] font-bold text-green-700" style={{minHeight: '16px'}}>{step.accepted || '\u00A0'}</span>
                        </td>
                        <td className="border-r border-gray-300 dark:border-slate-600 px-0.5 py-0">
                          <input
                            type="text"
                            value={step.sign}
                            onChange={(e) => updateStep(index, 'sign', e.target.value)}
                            className="w-full border-b-2 border-purple-400 text-center text-sm font-bold bg-transparent screen-only"
                            style={{padding: '1px 2px'}}
                            placeholder="Sign"
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[10px] font-bold" style={{minHeight: '16px'}}>{so.sign || '\u00A0'}</span>
                        </td>
                        <td className="px-0.5 py-0">
                          <input
                            type="text"
                            value={step.completedDate}
                            onChange={(e) => updateStep(index, 'completedDate', e.target.value)}
                            className="w-full border-b-2 border-gray-400 dark:border-slate-500 text-xs text-center bg-transparent screen-only"
                            style={{padding: '1px 1px'}}
                            placeholder="Date"
                          />
                          <span className="print-only inline-block w-full border-b border-gray-400 dark:border-slate-500 text-center text-[9px]" style={{minHeight: '16px'}}>{so.date || '\u00A0'}</span>
                        </td>
                  </tr>
                    )}
                  </SortableTableRow>
                  ) : (
                  <tr
                    key={index}
                    className="border-b border-gray-300 dark:border-slate-600 transition-colors duration-300"
                  >
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-1 py-1 text-center font-bold text-base print:px-0.5 print:py-0.5 print:text-[10px]">{step.seq}</td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-1 py-1 font-semibold text-sm break-words print:px-0.5 print:py-0.5 print:text-[9px]">
                          <div className="flex flex-row items-center justify-between gap-1 print:gap-0.5">
                            <span className="break-words">{step.workCenter.replace(/_/g, ' ')}</span>
                            {step.id && stepQRCodes[step.id] ? (
                              <img
                                src={`data:image/png;base64,${stepQRCodes[step.id]}`}
                                alt={`QR Code for ${step.workCenter}`}
                                className="border border-gray-200 dark:border-slate-600 flex-shrink-0 print:w-[50px] print:h-[50px] bg-white rounded"
                                style={{ width: '70px', height: '70px', padding: '1px' }}
                                data-print-img="step-qr" data-step-id={step.id} onLoad={() => handleStepQRLoad(step.id!)}
                                onError={() => {
                                  console.error('Failed to load QR code for step', step.id);
                                }}
                              />
                            ) : step.id && !stepQRCodesFetchDone ? (
                              <div className="text-[8px] text-gray-400 dark:text-slate-500 flex-shrink-0 print:hidden">QR Loading...</div>
                            ) : null}
                          </div>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-1 py-1 text-sm break-words print:px-0.5 print:py-0.5 print:text-[9px]" style={{minWidth: '120px'}}>
                          <div className="flex items-start gap-1">
                            {/* Empty box for the operator to pen-check when the step is done on the printed traveler */}
                            <span className="inline-block flex-shrink-0 mt-0.5 border border-gray-600 dark:border-slate-400" style={{width: '13px', height: '13px'}} />
                            <span className="inline-block flex-1 border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{step.instruction || '\u00A0'}</span>
                          </div>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm print:px-0.5 print:py-0.5 print:text-[9px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{so.time || '\u00A0'}</span>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm font-bold print:px-0.5 print:py-0.5 print:text-[10px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{step.quantity || '\u00A0'}</span>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm font-bold text-red-700 print:px-0.5 print:py-0.5 print:text-[10px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{step.rejected || '\u00A0'}</span>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm font-bold text-green-700 print:px-0.5 print:py-0.5 print:text-[10px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{step.accepted || '\u00A0'}</span>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm font-bold print:px-0.5 print:py-0.5 print:text-[10px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{so.sign || '\u00A0'}</span>
                        </td>
                        <td className="border-r-2 border-b-2 border-gray-400 dark:border-slate-500 px-0.5 py-1 text-center text-sm print:px-0.5 print:py-0.5 print:text-[9px]">
                          <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>{so.date || '\u00A0'}</span>
                        </td>
                  </tr>
                  );
                })}
                {displayTraveler.steps.length === 0 && (
                  <tr>
                    <td colSpan={isEditing ? 10 : 9} className="text-center py-8 text-gray-500 dark:text-slate-400 bg-yellow-50 dark:bg-yellow-900/20">
                      <div className="text-sm font-bold">⚠️ No work center steps found!</div>
                      {isEditing && (
                        <div className="text-xs mt-2">Click &quot;Add Step&quot; button above to add work center steps.</div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
              </SortableContext>
              </DndContext>
            </table>
            {isEditing && (
              <div className="flex justify-center py-2 no-print">
                <button
                  onClick={addStep}
                  className="flex items-center space-x-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs"
                >
                  <PlusIcon className="h-3 w-3" />
                  <span>Add Step</span>
                </button>
              </div>
            )}
            </div>

            {/* Mobile Card View */}
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayTraveler.steps.map(s => String(s.id ?? s.seq))} strategy={verticalListSortingStrategy}>
            <div className="routing-cards-mobile space-y-3 p-2">
              {displayTraveler.steps.map((step, index) => {
                const mobileStepId = String(step.id ?? step.seq);
                const so = signoffOf(step);
                return isEditing ? (
                <SortableMobileCard key={mobileStepId} id={mobileStepId}>
                  {({ dragHandleProps, style, ref }) => (
                <div ref={ref} style={style} className="bg-white dark:bg-slate-800 border-2 border-gray-400 dark:border-slate-500 rounded-lg shadow-sm">
                  {/* Card Header */}
                  <div className="bg-gray-200 dark:bg-slate-700 border-b-2 border-gray-400 dark:border-slate-500 px-3 py-2 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        {...dragHandleProps}
                        className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 touch-none"
                        title="Drag to reorder"
                      >
                        <Bars3Icon className="h-5 w-5" />
                      </button>
                      <span className="bg-blue-600 text-white font-bold px-2 py-1 rounded text-sm">
                        SQ {isEditing ? (
                          <input
                            type="number"
                            value={step.seq}
                            onChange={(e) => updateStep(index, 'seq', parseInt(e.target.value) || 0)}
                            className="w-14 ml-1 border border-white rounded px-1 text-center bg-blue-700 text-white font-bold text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        ) : step.seq}
                      </span>
                      <span className="font-bold text-base">{step.workCenter.replace(/_/g, ' ')}</span>
                    </div>
                    {isEditing && (
                      <button
                        onClick={() => removeStep(index)}
                        className="p-1 bg-red-600 hover:bg-red-700 text-white rounded"
                        title="Remove step"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Card Content */}
                  <div className="p-3 space-y-3">
                    {/* Work Center (edit mode only since it's shown in header) */}
                    {isEditing && (
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Work Center</label>
                        <select
                          value={step.workCenter}
                          onChange={(e) => updateStep(index, 'workCenter', e.target.value)}
                          className="block w-full border-2 border-blue-400 rounded-lg px-2 font-medium hover:border-blue-500 focus:border-blue-600 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-800 cursor-pointer"
                          style={{
                            minHeight: '28px',
                            fontSize: '13px',
                            lineHeight: '1.2',
                            paddingTop: '4px',
                            paddingBottom: '4px',
                            width: '100%',
                            maxWidth: '80vw',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden'
                          }}
                        >
                          <option value="" style={{ fontSize: '13px' }}>Select Work Center...</option>
                          {dynamicWorkCenters.map(wc => (
                            <option key={wc.name} value={wc.name} title={wc.description} style={{ fontSize: '13px' }}>{wc.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Instructions */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Instructions</label>
                      {isEditing ? (
                        <textarea
                          value={step.instruction}
                          onChange={(e) => updateStep(index, 'instruction', e.target.value)}
                          className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 min-h-[60px] text-sm"
                          placeholder="Enter instructions..."
                        />
                      ) : (
                        <div className="text-sm bg-gray-50 dark:bg-slate-900 p-2 rounded min-h-[40px]">
                          {step.instruction || <span className="text-gray-400 dark:text-slate-500">No instructions</span>}
                        </div>
                      )}
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Quantity</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.quantity}
                            onChange={(e) => updateStep(index, 'quantity', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-center text-sm font-bold bg-gray-50 dark:bg-slate-900"
                          />
                        ) : (
                          <div className="text-sm font-bold text-center bg-gray-50 dark:bg-slate-900 p-1.5 rounded">{step.quantity || '-'}</div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-red-700 mb-1">Rejected</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.rejected}
                            onChange={(e) => updateStep(index, 'rejected', e.target.value)}
                            className="w-full border border-red-300 rounded px-2 py-1.5 text-center text-sm font-bold text-red-700 bg-red-50"
                          />
                        ) : (
                          <div className="text-sm font-bold text-center text-red-700 bg-red-50 p-1.5 rounded">{step.rejected || '-'}</div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-green-700 mb-1">Accepted</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.accepted}
                            onChange={(e) => updateStep(index, 'accepted', e.target.value)}
                            className="w-full border border-green-300 rounded px-2 py-1.5 text-center text-sm font-bold text-green-700 bg-green-50"
                          />
                        ) : (
                          <div className="text-sm font-bold text-center text-green-700 bg-green-50 p-1.5 rounded">{step.accepted || '-'}</div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-purple-700 mb-1">Sign</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.sign}
                            onChange={(e) => updateStep(index, 'sign', e.target.value)}
                            className="w-full border border-purple-300 rounded px-2 py-1.5 text-center text-sm font-bold bg-purple-50"
                            placeholder="Sign"
                          />
                        ) : (
                          <div className="text-sm font-bold text-center bg-purple-50 p-1.5 rounded">{so.sign || '-'}</div>
                        )}
                      </div>
                    </div>

                    {/* Time and Date */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Time (Hrs)</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.completedTime || ''}
                            onChange={(e) => updateStep(index, 'completedTime', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm text-center"
                            placeholder="Hrs"
                          />
                        ) : (
                          <div className="text-sm text-center bg-gray-50 dark:bg-slate-900 p-1.5 rounded">{so.time || '-'}</div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Date</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.completedDate}
                            onChange={(e) => updateStep(index, 'completedDate', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm text-center"
                            placeholder="Date"
                          />
                        ) : (
                          <div className="text-sm text-center bg-gray-50 dark:bg-slate-900 p-1.5 rounded">{so.date || '-'}</div>
                        )}
                      </div>
                    </div>

                    {/* QR Code */}
                    {step.id && stepQRCodes[step.id] && (
                      <div className="flex justify-center pt-2 border-t border-gray-200 dark:border-slate-700">
                        <img
                          src={`data:image/png;base64,${stepQRCodes[step.id]}`}
                          alt={`QR Code for ${step.workCenter}`}
                          className="border border-gray-200 dark:border-gray-600 rounded bg-white"
                          style={{ width: '80px', height: '80px', padding: '1px' }}
                          data-print-img="step-qr" data-step-id={step.id} onLoad={() => handleStepQRLoad(step.id!)}
                          onError={() => {
                            console.error('Failed to load QR code for step', step.id);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                  )}
                </SortableMobileCard>
                ) : (
                <div key={index} className="bg-white dark:bg-slate-800 border-2 border-gray-400 dark:border-slate-500 rounded-lg shadow-sm">
                  {/* Card Header (view mode) */}
                  <div className="bg-gray-200 dark:bg-slate-700 border-b-2 border-gray-400 dark:border-slate-500 px-3 py-2 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <span className="bg-blue-600 text-white font-bold px-2 py-1 rounded text-sm">
                        SQ {step.seq}
                      </span>
                      <span className="font-bold text-base">{step.workCenter.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-3">
                    {step.instruction && (
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Instructions</label>
                        <div className="text-sm bg-gray-50 dark:bg-slate-900 p-2 rounded">{step.instruction}</div>
                      </div>
                    )}
                    <div className="grid grid-cols-4 gap-2">
                      <div><label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">QTY</label><div className="text-sm text-center bg-gray-50 dark:bg-slate-900 p-1.5 rounded">{step.quantity || '-'}</div></div>
                      <div><label className="block text-xs font-bold text-red-700 mb-1">REJ</label><div className="text-sm text-center bg-red-50 p-1.5 rounded text-red-700">{step.rejected || '-'}</div></div>
                      <div><label className="block text-xs font-bold text-green-700 mb-1">ACC</label><div className="text-sm text-center bg-green-50 p-1.5 rounded text-green-700">{step.accepted || '-'}</div></div>
                      <div><label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">SIGN</label><div className="text-sm text-center bg-gray-50 dark:bg-slate-900 p-1.5 rounded">{so.sign || '-'}</div></div>
                    </div>
                    {step.id && stepQRCodes[step.id] && (
                      <div className="flex justify-center pt-2 border-t border-gray-200 dark:border-slate-700">
                        <img src={`data:image/png;base64,${stepQRCodes[step.id]}`} alt={`QR Code for ${step.workCenter}`} className="border border-gray-200 dark:border-gray-600 rounded bg-white" style={{ width: '60px', height: '60px', padding: '3px' }} data-print-img="step-qr" data-step-id={step.id} onLoad={() => handleStepQRLoad(step.id!)} />
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              {displayTraveler.steps.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-slate-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border-2 border-yellow-200 dark:border-yellow-800">
                  <div className="text-sm font-bold">⚠️ No work center steps found!</div>
                  {isEditing && (
                    <div className="text-xs mt-2">Click &quot;Add Step&quot; button above to add work center steps.</div>
                  )}
                </div>
              )}
            </div>
            </SortableContext>
            </DndContext>

            {/* Bottom Info - hidden for RMA types (already in RMA header) */}
            <div className={`bg-gray-50 dark:bg-slate-900 px-2 sm:px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-sm border-t border-gray-300 dark:border-slate-600 print:px-2 print:py-1 print:gap-2 print:text-[9px] print:!grid-cols-3 ${isRmaType(displayTraveler.travelerType) ? 'hidden' : ''}`}>
              <div className="flex flex-row items-baseline gap-1 print:gap-0.5">
                <span className="font-bold min-w-[85px] print:min-w-[60px] print:text-[9px] text-black dark:text-white">From Stock:</span>
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editData.fromStock}
                      onChange={(e) => updateField('fromStock', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded bg-transparent px-2 py-1 screen-only text-black dark:text-white"
                      style={{outline: 'none'}}
                    />
                    <span className="print-only flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{editData.fromStock || '-'}</span>
                  </>
                ) : (
                  <span className="flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{displayTraveler.fromStock || '-'}</span>
                )}
              </div>
              <div className="flex flex-row items-baseline gap-1 print:gap-0.5">
                <span className="font-bold min-w-[85px] print:min-w-[60px] print:text-[9px] text-black dark:text-white">To Stock:</span>
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editData.toStock}
                      onChange={(e) => updateField('toStock', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded bg-transparent px-2 py-1 screen-only text-black dark:text-white"
                      style={{outline: 'none'}}
                    />
                    <span className="print-only flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{editData.toStock || '-'}</span>
                  </>
                ) : (
                  <span className="flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{displayTraveler.toStock || '-'}</span>
                )}
              </div>
              <div className="flex flex-row items-baseline gap-1">
                <span className="font-bold min-w-[85px] print:min-w-[60px] print:text-[9px] text-black dark:text-white">Ship Via:</span>
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editData.shipVia}
                      onChange={(e) => updateField('shipVia', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-slate-600 rounded bg-transparent px-2 py-1 screen-only text-black dark:text-white"
                      style={{outline: 'none'}}
                    />
                    <span className="print-only flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{editData.shipVia || '-'}</span>
                  </>
                ) : (
                  <span className="flex-1 px-1 break-words print:text-[9px] text-black dark:text-white">{displayTraveler.shipVia || '-'}</span>
                )}
              </div>
            </div>
          </div>

          {/* Labor Hours Toggle - Edit Mode Only - NO PRINT - Hidden for RMA types */}
          {isEditing && !isRmaType(displayTraveler.travelerType) && (
            <div className="border-b-2 border-black dark:border-slate-600 no-print">
              <div className="bg-blue-200 dark:bg-blue-900/50 print:!bg-blue-200 px-3 py-2">
                <h2 className="font-bold text-sm text-blue-900 dark:text-blue-200 print:!text-black">TRAVELER OPTIONS</h2>
              </div>
              <div className="bg-blue-50 dark:bg-slate-800 p-4">
                <div className="flex items-center space-x-3 p-3 bg-white dark:bg-slate-800 rounded border-2 border-blue-300">
                  <input
                    type="checkbox"
                    id="editIncludeLaborHours"
                    checked={editData.includeLaborHours}
                    onChange={(e) => {
                      const newValue = e.target.checked;
                      setEditedTraveler({ ...editData, includeLaborHours: newValue });
                      if (newValue) {
                        toast.success('Labor Hours Table will be included in this traveler! The labor tracking section will appear at the end of the traveler document when printed.');
                      } else {
                        toast.warning('Labor Hours Table will be removed from this traveler! The labor tracking section will NOT appear in the printed document.');
                      }
                    }}
                    className="w-5 h-5 text-blue-600 border border-gray-300 dark:border-slate-600 rounded cursor-pointer"
                  />
                  <label htmlFor="editIncludeLaborHours" className="flex-1 cursor-pointer">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-slate-100">Include Labor Hours Table</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {editData.includeLaborHours ? '✓ Labor tracking enabled - will print on second page' : 'Add labor tracking section to traveler'}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Comments Section - for non-RMA types shown here; for RMA shown on page 2.
              When there are no comments this whole block (plus the blank writing
              space below) is hidden from print so the printout doesn't end on an
              otherwise-empty trailing page — it stops at the From/To Stock / Ship Via row. */}
          {!isRmaType(displayTraveler.travelerType) && (
          <div className={`border-b-2 border-black dark:border-slate-600 ${((isEditing ? editData.comments : displayTraveler.comments) || '').trim() ? '' : 'print:hidden'}`}>
            <div className="bg-purple-200 dark:bg-purple-900/50 print:!bg-purple-200 px-3 py-2 print:px-1 print:py-0">
              <h2 className="font-bold text-sm text-purple-900 dark:text-purple-200 print:!text-black print:text-[9px] print-section-title">COMMENTS & NOTES</h2>
            </div>
            <div className="bg-purple-50 dark:bg-slate-800 p-3 min-h-[60px] text-sm print:p-1 print:min-h-[40px] print:text-[8px]">
              {isEditing ? (
                <>
                  <textarea
                    value={editData.comments}
                    onChange={(e) => updateField('comments', e.target.value)}
                    className="w-full p-2 border border-gray-300 dark:border-slate-600 rounded min-h-[60px] text-sm screen-only"
                    placeholder="Enter comments..."
                  />
                  <div className="print-only whitespace-pre-wrap text-sm print:text-[8px]">{editData.comments || <span className="text-gray-400 dark:text-slate-500 italic">No comments</span>}</div>
                </>
              ) : (
                <div className="whitespace-pre-wrap text-sm print:text-[8px]">{displayTraveler.comments || <span className="text-gray-400 dark:text-slate-500 italic">No comments</span>}</div>
              )}
            </div>
          </div>
          )}

          {/* Additional Instructions/Comments Space - not for RMA types.
              Hidden from print when there are no comments (see note above) so this
              near-full-page blank box doesn't create an empty trailing page. */}
          {!isRmaType(displayTraveler.travelerType) && (
          <div className={`border-b-2 border-black dark:border-slate-600 ${((isEditing ? editData.comments : displayTraveler.comments) || '').trim() ? '' : 'print:hidden'}`}>
            <div className="bg-gray-50 dark:bg-slate-900 p-3 min-h-[120px] print:min-h-[750px] text-sm print:p-1">
              <div className="text-gray-400 dark:text-slate-500 text-xs print:text-[8px]">Additional Instructions/Comments:</div>
            </div>
          </div>
          )}

          {/* Documents (uploaded files render inline on screen AND print) +
              Communication Log (screen only). travelerId is the numeric DB id
              (displayTraveler.id is the job number, not the DB id). */}
          {displayTraveler?.travelerId ? (
            <>
              <JobDocuments travelerId={displayTraveler.travelerId} />
              <CommunicationLogSection travelerId={displayTraveler.travelerId} />
            </>
          ) : null}

          {/* RMA Page 2: Comments + Unit Tracking */}
          {isRmaType(displayTraveler.travelerType) && (
          <div className="rma-page2-content">
            {/* Comments & Notes for RMA - on page 2. Same rule as the non-RMA
                block above: with no comments the tall (480px print) box is
                dropped from print, so page 2 starts at the unit tracking table
                instead of a half page of empty purple. Screen view unchanged. */}
            <div className={`border-b-2 border-black dark:border-slate-600 ${((isEditing ? editData.comments : displayTraveler.comments) || '').trim() ? '' : 'print:hidden'}`}>
              <div className="bg-purple-200 dark:bg-purple-900/50 print:!bg-purple-200 px-3 py-2 print:px-1 print:py-0">
                <h2 className="font-bold text-sm text-purple-900 dark:text-purple-200 print:!text-black print:text-[9px]">COMMENTS & NOTES</h2>
              </div>
              <div className="bg-purple-50 dark:bg-slate-800 p-3 min-h-[40px] text-sm print:p-1 print:min-h-[480px] print:text-[8px]">
                {isEditing ? (
                  <>
                    <textarea value={editData.comments} onChange={(e) => updateField('comments', e.target.value)} className="w-full p-2 border border-gray-300 dark:border-slate-600 rounded min-h-[60px] text-sm screen-only" placeholder="Enter comments..." />
                    <div className="print-only whitespace-pre-wrap text-sm print:text-[8px]">{editData.comments || <span className="text-gray-400 dark:text-slate-500 italic">No comments</span>}</div>
                  </>
                ) : (
                  <div className="whitespace-pre-wrap text-sm print:text-[8px]">{displayTraveler.comments || <span className="text-gray-400 dark:text-slate-500 italic">No comments</span>}</div>
                )}
              </div>
            </div>
            {/* For RMA_DIFF type, show per-unit original job info table first */}
            {displayTraveler.travelerType === 'RMA_DIFF' && (
            <div className="border-b-2 border-black dark:border-slate-600">
              <div className="bg-pink-200 dark:bg-pink-900/50 print:!bg-pink-200 border-b border-black dark:border-slate-600 px-3 py-2 flex justify-between items-center">
                <h2 className="font-bold text-sm text-pink-900 dark:text-pink-200 print:!text-black print:text-[10px]">UNIT ORIGINAL JOB INFORMATION</h2>
                {isEditing && (
                  <button onClick={addRmaUnit} className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm no-print">
                    <PlusIcon className="h-4 w-4" /><span>Add Unit</span>
                  </button>
                )}
              </div>
              <div className="overflow-x-auto print:overflow-x-visible">
                <table className="w-full border-collapse text-sm print:text-[8px]">
                  <thead>
                    <tr className="bg-pink-100 dark:bg-pink-900/30 border-b-2 border-black dark:border-slate-600">
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-center font-bold w-10">No.</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Serial Number</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Customer NCR</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Original PO#</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Original WO#</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Cust. Rev Sent</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-left font-bold">Cust. Rev Recv</th>
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-center font-bold">Orig. Built Qty</th>
                      <th className="px-2 py-2 text-center font-bold">Units Shipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(displayTraveler.rmaUnits || []).map((unit, idx) => (
                      <tr key={idx} className="border-b border-gray-300 dark:border-slate-600" style={{height: '40px'}}>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2 text-center font-bold">{unit.unit_number}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.serial_number} onChange={(e) => updateRmaUnit(idx, 'serial_number', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.serial_number || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.customer_ncr || ''} onChange={(e) => updateRmaUnit(idx, 'customer_ncr', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.customer_ncr || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.original_po_number || ''} onChange={(e) => updateRmaUnit(idx, 'original_po_number', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.original_po_number || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.original_wo_number || ''} onChange={(e) => updateRmaUnit(idx, 'original_wo_number', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.original_wo_number || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.customer_revision_sent || ''} onChange={(e) => updateRmaUnit(idx, 'customer_revision_sent', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.customer_revision_sent || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2">{isEditing ? <input type="text" value={unit.customer_revision_received || ''} onChange={(e) => updateRmaUnit(idx, 'customer_revision_received', e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" /> : (unit.customer_revision_received || '')}</td>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2 text-center">{isEditing ? <input type="number" value={unit.original_built_quantity || ''} onChange={(e) => updateRmaUnit(idx, 'original_built_quantity', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-center text-black dark:text-white" /> : (unit.original_built_quantity || '')}</td>
                        <td className="px-2 py-2 text-center">{isEditing ? <input type="number" value={unit.units_shipped || ''} onChange={(e) => updateRmaUnit(idx, 'units_shipped', parseInt(e.target.value) || 0)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-center text-black dark:text-white" /> : (unit.units_shipped || '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* Unit Serial Number Tracking Table (all RMA types) */}
            {(() => {
              const tableColumns: RmaTableColumn[] = (editedTraveler?.rmaTableColumns || displayTraveler.rmaTableColumns || DEFAULT_RMA_TABLE_COLUMNS);
              const cellValue = (unit: RmaUnit, col: RmaTableColumn): string => {
                if (col.type === 'standard') {
                  return ((unit as unknown as Record<string, unknown>)[col.key] as string) || '';
                }
                return (unit.custom_values && unit.custom_values[col.key]) || '';
              };
              const onCellChange = (idx: number, col: RmaTableColumn, value: string) => {
                if (col.type === 'standard') {
                  updateRmaUnit(idx, col.key as keyof RmaUnit, value);
                } else {
                  updateRmaUnitCustom(idx, col.key, value);
                }
              };
              return (
            <div className="border-b-2 border-black dark:border-slate-600">
              <div className="bg-red-200 dark:bg-red-900/50 print:!bg-red-200 border-b border-black dark:border-slate-600 px-3 py-2 flex justify-between items-center gap-2 flex-wrap">
                <h2 className="font-bold text-sm text-red-900 dark:text-red-200 print:!text-black print:text-[10px]">UNIT SERIAL NUMBER TRACKING</h2>
                {isEditing && (
                  <div className="flex items-center gap-2 no-print">
                    <button onClick={addRmaTableColumn} className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm" title="Add a new column to this table">
                      <PlusIcon className="h-4 w-4" /><span>Add Column</span>
                    </button>
                    {displayTraveler.travelerType !== 'RMA_DIFF' && (
                      <button onClick={addRmaUnit} className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm">
                        <PlusIcon className="h-4 w-4" /><span>Add Unit</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="overflow-x-auto print:overflow-x-visible">
                <table className="w-full border-collapse text-sm print:text-[8px]" style={{tableLayout: 'fixed'}}>
                  <colgroup>
                    <col style={{width: '40px'}} />
                    {tableColumns.map(col => (
                      <col key={col.key} style={{width: `${col.width || RMA_COL_DEFAULT_WIDTH}px`}} />
                    ))}
                    {isEditing && <col style={{width: '40px'}} />}
                  </colgroup>
                  <thead>
                    <tr className="bg-red-100 dark:bg-red-900/30 border-b-2 border-black dark:border-slate-600">
                      <th className="border-r border-black dark:border-slate-600 px-2 py-2 text-center font-bold">No.</th>
                      {tableColumns.map((col, ci) => {
                        const isLast = ci === tableColumns.length - 1;
                        return (
                          <th key={col.key} className={`relative ${isLast ? '' : 'border-r border-black dark:border-slate-600'} px-2 py-2 text-left font-bold align-top whitespace-normal break-normal`}>
                            <div className="flex items-start justify-between gap-1">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={col.label}
                                  onChange={(e) => renameRmaTableColumn(col.key, e.target.value)}
                                  className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-1.5 py-0.5 font-bold text-sm text-black dark:text-white print:border-none print:bg-transparent print:px-0 print:py-0"
                                  placeholder="Column name"
                                  title="Click to rename this column"
                                />
                              ) : (
                                <span className="whitespace-normal break-normal">{col.label}</span>
                              )}
                              {isEditing && (
                                <button onClick={() => removeRmaTableColumn(col.key)} className="text-red-600 hover:text-red-800 no-print shrink-0 mt-0.5" title={`Delete column "${col.label}"`}>
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {isEditing && (
                              <div className="flex items-center gap-1 mt-1 no-print" title="Adjust this column's width (applies to print)">
                                <span className="text-[10px] text-gray-500 dark:text-slate-400">Width</span>
                                <button onClick={() => resizeRmaTableColumn(col.key, -RMA_COL_WIDTH_STEP)} className="px-1.5 py-0.5 text-xs font-bold leading-none bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 border border-gray-400 dark:border-slate-500 rounded" title="Narrower">−</button>
                                <span className="text-[10px] text-gray-600 dark:text-slate-300 tabular-nums w-9 text-center">{col.width || RMA_COL_DEFAULT_WIDTH}px</span>
                                <button onClick={() => resizeRmaTableColumn(col.key, RMA_COL_WIDTH_STEP)} className="px-1.5 py-0.5 text-xs font-bold leading-none bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 border border-gray-400 dark:border-slate-500 rounded" title="Wider">+</button>
                              </div>
                            )}
                            {isEditing && (
                              <div
                                onMouseDown={(e) => startColResize(e, col)}
                                className="absolute top-0 right-0 h-full w-2 cursor-col-resize bg-blue-400/50 hover:bg-blue-600 no-print"
                                title="Drag to resize this column"
                              />
                            )}
                          </th>
                        );
                      })}
                      {isEditing && <th className="px-2 py-2 no-print"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(displayTraveler.rmaUnits || []).map((unit, idx) => (
                      <tr key={idx} className="border-b border-gray-300 dark:border-slate-600" style={{height: '44px'}}>
                        <td className="border-r border-black dark:border-slate-600 px-2 py-2 text-center font-bold">{unit.unit_number}</td>
                        {tableColumns.map((col, ci) => {
                          const isLast = ci === tableColumns.length - 1;
                          const value = cellValue(unit, col);
                          return (
                            <td key={col.key} className={`${isLast ? '' : 'border-r border-black dark:border-slate-600'} px-2 py-2 align-top break-words`}>
                              {isEditing ? (
                                <input type="text" value={value} onChange={(e) => onCellChange(idx, col, e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-black dark:text-white" />
                              ) : (<span className="block whitespace-pre-wrap break-words">{value || ''}</span>)}
                            </td>
                          );
                        })}
                        {isEditing && (
                          <td className="px-2 py-2 no-print">
                            <button onClick={() => removeRmaUnit(idx)} className="text-red-500 hover:text-red-700"><TrashIcon className="h-4 w-4" /></button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
              );
            })()}
          </div>
          )}

          {/* Labor Hours Section - Second Page (Page Break Before) - Show if includeLaborHours is true, hidden for RMA types */}
          {displayTraveler.includeLaborHours && !isRmaType(displayTraveler.travelerType) && (
            <div className="print:break-before-page">
              <div className="bg-purple-200 dark:bg-purple-900/50 print:!bg-purple-200 border-b-4 border-black dark:border-slate-600 print:!border-black px-4 py-4">
                <h2 className="font-bold text-3xl text-purple-900 dark:text-purple-200 print:!text-black">LABOR HOURS TRACKING</h2>
              </div>
              <div className="overflow-x-auto print:overflow-x-visible">
              <table className="labor-table-desktop w-full border-collapse min-w-[640px]">
                <thead>
                  <tr className="bg-purple-100 dark:bg-purple-900/30 border-b-4 border-black dark:border-slate-600">
                    <th className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-left font-bold text-2xl">WORK CENTER</th>
                    <th className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-left font-bold text-2xl">OPERATOR NAME</th>
                    <th className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-center font-bold text-2xl">START TIME</th>
                    <th className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-center font-bold text-2xl">END TIME</th>
                    <th className="px-6 py-5 text-center font-bold text-2xl">TOTAL HOURS</th>
                  </tr>
                </thead>
                <tbody>
                  {displayTraveler.laborEntries.map((entry) => (
                    <tr key={entry.id} className="border-b-4 border-gray-600 dark:border-slate-500" style={{height: '65px'}}>
                      {isEditing ? (
                        <>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-2 py-2">
                            <input
                              type="text"
                              value={entry.workCenter}
                              onChange={(e) => updateLaborEntry(entry.id, 'workCenter', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-lg"
                              placeholder="Work center"
                            />
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-2 py-2">
                            <input
                              type="text"
                              value={entry.operatorName}
                              onChange={(e) => updateLaborEntry(entry.id, 'operatorName', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-lg"
                              placeholder="Operator name"
                            />
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-2 py-2">
                            <input
                              type="time"
                              value={entry.startTime}
                              onChange={(e) => updateLaborEntry(entry.id, 'startTime', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-lg"
                            />
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-2 py-2">
                            <input
                              type="time"
                              value={entry.endTime}
                              onChange={(e) => updateLaborEntry(entry.id, 'endTime', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-lg"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              value={entry.totalHours}
                              onChange={(e) => updateLaborEntry(entry.id, 'totalHours', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-lg"
                              placeholder="Hours"
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-6 text-xl">
                            {entry.workCenter || <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>&nbsp;</span>}
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-6 text-xl">
                            {entry.operatorName || <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>&nbsp;</span>}
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-6 text-xl text-center">
                            {entry.startTime || <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>&nbsp;</span>}
                          </td>
                          <td className="border-r-4 border-gray-600 dark:border-slate-500 px-6 text-xl text-center">
                            {entry.endTime || <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>&nbsp;</span>}
                          </td>
                          <td className="px-6 text-xl text-center">
                            {entry.totalHours || <span className="inline-block w-full border-b border-gray-400 dark:border-slate-500" style={{minHeight: '16px'}}>&nbsp;</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-purple-200 dark:bg-purple-900/50 border-t-4 border-black dark:border-slate-600" style={{height: '70px'}}>
                    <td colSpan={3} className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-right font-bold text-2xl">TOTAL HOURS:</td>
                    <td className="border-r-4 border-black dark:border-slate-600 px-6 py-5 text-2xl"></td>
                    <td className="px-6 py-5 text-2xl"></td>
                  </tr>
                </tbody>
              </table>
              </div>

              {/* Mobile Card View for Labor Hours */}
              <div className="labor-cards-mobile space-y-3 p-2">
                {displayTraveler.laborEntries.map((entry) => (
                  <div key={entry.id} className="bg-white dark:bg-slate-800 border-2 border-purple-400 rounded-lg shadow-sm">
                    <div className="bg-purple-100 dark:bg-purple-900/30 border-b-2 border-purple-400 dark:border-purple-700 px-3 py-2">
                      <h3 className="font-bold text-sm text-purple-900 dark:text-purple-200">Labor Entry #{entry.id}</h3>
                    </div>
                    <div className="p-3 space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Work Center</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={entry.workCenter}
                            onChange={(e) => updateLaborEntry(entry.id, 'workCenter', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-base"
                            placeholder="Work center"
                          />
                        ) : (
                          <div className="text-base bg-gray-50 dark:bg-slate-900 p-2 rounded min-h-[40px]">
                            {entry.workCenter || <span className="text-gray-400 dark:text-slate-500">-</span>}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Operator Name</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={entry.operatorName}
                            onChange={(e) => updateLaborEntry(entry.id, 'operatorName', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-base"
                            placeholder="Operator name"
                          />
                        ) : (
                          <div className="text-base bg-gray-50 dark:bg-slate-900 p-2 rounded min-h-[40px]">
                            {entry.operatorName || <span className="text-gray-400 dark:text-slate-500">-</span>}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Start Time</label>
                          {isEditing ? (
                            <input
                              type="time"
                              value={entry.startTime}
                              onChange={(e) => updateLaborEntry(entry.id, 'startTime', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-base"
                            />
                          ) : (
                            <div className="text-base text-center bg-gray-50 dark:bg-slate-900 p-2 rounded">
                              {entry.startTime || <span className="text-gray-400 dark:text-slate-500">-</span>}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">End Time</label>
                          {isEditing ? (
                            <input
                              type="time"
                              value={entry.endTime}
                              onChange={(e) => updateLaborEntry(entry.id, 'endTime', e.target.value)}
                              className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-base"
                            />
                          ) : (
                            <div className="text-base text-center bg-gray-50 dark:bg-slate-900 p-2 rounded">
                              {entry.endTime || <span className="text-gray-400 dark:text-slate-500">-</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Total Hours</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={entry.totalHours}
                            onChange={(e) => updateLaborEntry(entry.id, 'totalHours', e.target.value)}
                            className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-base"
                            placeholder="Hours"
                          />
                        ) : (
                          <div className="text-base text-center bg-gray-50 dark:bg-slate-900 p-2 rounded font-bold">
                            {entry.totalHours || <span className="text-gray-400 dark:text-slate-500">-</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          </div>
        </div>
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
                className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
