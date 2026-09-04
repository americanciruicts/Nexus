'use client';

import { useState, useEffect, useRef } from 'react';
import { TravelerType } from '@/types';
import { getWorkCentersByType, WorkCenterItem } from '@/data/workCenters';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/config/api';
import {
  PlusIcon,
  TrashIcon,
  Bars3Icon
} from '@heroicons/react/24/outline';
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
import { acceptCustomerCode } from '@/lib/customerCode';

// Sortable wrapper for drag-and-drop step cards
function SortableStepItem({ id, children }: { id: string; children: (props: { dragHandleProps: Record<string, unknown>; style: React.CSSProperties; ref: (node: HTMLElement | null) => void }) => React.ReactNode }) {
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

interface TravelerFormProps {
  mode?: 'create' | 'edit' | 'view';
  initialData?: Record<string, unknown>;
  travelerId?: string;
  // When true, the form is cloning an existing traveler: start in DRAFT with
  // no work-order number. WO is generated later when the user moves the
  // traveler from Draft → Awaiting Start.
  isClone?: boolean;
}

interface FormStep {
  id: string;
  sequence: number;
  workCenter: string;
  instruction: string;
  quantity: number;
  rejected: number;
  accepted: number;
  assign: string;
  date: string;
}

interface TravelerListItem {
  id: number;
  job_number: string;
  work_order_number?: string;
  part_number: string;
  part_description: string;
}

interface ProcessStepData {
  step_number: number;
  operation?: string;
  work_center_code: string;
  instructions: string;
  quantity?: number;
  rejected?: number;
  accepted?: number;
  sign?: string;
  completed_date?: string;
}

interface FullTravelerData {
  id: number;
  job_number: string;
  work_order_number?: string;
  po_number?: string;
  traveler_type?: string;
  part_number: string;
  part_description: string;
  revision: string;
  customer_revision?: string;
  part_revision?: string;
  quantity: number;
  customer_code?: string;
  customer_name?: string;
  priority?: string;
  specs?: string;
  specs_date?: string;
  from_stock?: string;
  to_stock?: string;
  ship_via?: string;
  comments?: string;
  due_date?: string;
  ship_date?: string;
  include_labor_hours?: boolean;
  is_lead_free?: boolean;
  is_itar?: boolean;
  status?: string;
  is_active?: boolean;
  work_center?: string;
  process_steps?: ProcessStepData[];
}

// Helper function to convert any date format to YYYY-MM-DD for date inputs
const extractDateOnly = (dateStr: unknown): string => {
  if (!dateStr) return '';
  const str = String(dateStr);

  // If already YYYY-MM-DD, return as is
  const ymdMatch = str.match(/^\d{4}-\d{2}-\d{2}/);
  if (ymdMatch) return ymdMatch[0];

  // If MM/DD/YYYY format, convert to YYYY-MM-DD
  const mdyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month}-${day}`;
  }

  // If ISO timestamp format (YYYY-MM-DDTHH:mm:ss), extract date part
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return '';
};

export default function TravelerForm({ mode = 'create', initialData, travelerId, isClone = false }: TravelerFormProps) {
  // Step 1: Select Traveler Type
  const [selectedType, setSelectedType] = useState<TravelerType | ''>(initialData?.traveler_type as TravelerType || '');
  const [showForm, setShowForm] = useState(mode === 'edit' || false);

  // Update selectedType when initialData loads (for edit mode)
  useEffect(() => {
    if (mode === 'edit' && initialData?.traveler_type) {
      setSelectedType(initialData.traveler_type as TravelerType);
      setShowForm(true);
    }
  }, [mode, initialData?.traveler_type]);

  // Split work order into prefix (auto-generated) and suffix (user-editable)
  const splitWorkOrder = (workOrder: string): { prefix: string; suffix: string } => {
    if (!workOrder) return { prefix: '', suffix: '' };
    const parts = workOrder.split('-');
    if (parts.length >= 2) {
      return { prefix: parts[0], suffix: parts.slice(1).join('-') };
    }
    return { prefix: workOrder, suffix: '' };
  };

  // Clones start without a work-order — the WO is assigned on Draft → Awaiting
  // Start. For regular edit/view the incoming WO is preserved.
  const initialWorkOrder = isClone ? '' : String(initialData?.work_order_number || '');
  const { prefix: initialPrefix, suffix: initialSuffix } = splitWorkOrder(initialWorkOrder);

  const [workOrderPrefix, setWorkOrderPrefix] = useState(initialPrefix);
  const [workOrderSuffix, setWorkOrderSuffix] = useState(initialSuffix);

  const [formData, setFormData] = useState({
    jobNumber: String(initialData?.job_number || ''),
    workOrderNumber: initialWorkOrder,
    partNumber: String(initialData?.part_number || ''),
    partDescription: String(initialData?.part_description || ''),
    revision: String(initialData?.revision || ''),
    customerRevision: String(initialData?.customer_revision || ''),
    partRevision: String(initialData?.part_revision || ''),
    quantity: Number(initialData?.quantity) || 0,
    customerCode: String(initialData?.customer_code || ''),
    customerName: String(initialData?.customer_name || ''),
    priority: (initialData?.priority || 'NORMAL') as 'LOW' | 'NORMAL' | 'PREMIUM' | 'HIGH' | 'URGENT',
    notes: String(initialData?.notes || ''),
    poNumber: '',
    operation: '',
    pageNumber: '1',
    totalPages: '1',
    drawingNumber: '',
    specs: String(initialData?.specs || ''),
    specsDate: '',
    fromStock: String(initialData?.from_stock || ''),
    toStock: String(initialData?.to_stock || ''),
    shipVia: String(initialData?.ship_via || ''),
    lot: '',
    startDate: extractDateOnly(initialData?.start_date || initialData?.created_at) || new Date().toISOString().split('T')[0],
    dueDate: extractDateOnly(initialData?.due_date),
    shipDate: extractDateOnly(initialData?.ship_date),
    comments: String(initialData?.comments || '')
  });

  const [formSteps, setFormSteps] = useState<FormStep[]>([]);
  const [isLeadFree, setIsLeadFree] = useState(false);
  const [isITAR, setIsITAR] = useState(false);
  const [includeLaborHours, setIncludeLaborHours] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [travelerDbId, setTravelerDbId] = useState<number | null>(null);
  const [autoPopulatedRevision, setAutoPopulatedRevision] = useState<string>('');
  const [wasAutoPopulated, setWasAutoPopulated] = useState(false);

  // Work order selector for jobs with multiple work orders
  const [existingWorkOrders, setExistingWorkOrders] = useState<FullTravelerData[]>([]);
  const [showWorkOrderSelector, setShowWorkOrderSelector] = useState(false);
  // What the operator typed — a bare job like "8762L" can match several filed
  // jobs ("8762L CABLE", "8762L KANBAN"), so the picker heads with the term.
  const [lookupTerm, setLookupTerm] = useState('');

  // Dynamic work centers from DB (fetched per traveler type)
  const [dynamicWorkCenters, setDynamicWorkCenters] = useState<WorkCenterItem[]>([]);

  // KOSH job data (when pre-filling from KOSH inventory job)
  const [koshJobData, setKoshJobData] = useState<{job_number: string; description: string; customer: string; cust_pn: string; order_qty: number; job_rev: string; cust_rev: string; wo_number: string} | null>(null);

  // Fill form from KOSH job (fallback when no NEXUS traveler exists)
  const fillFromKoshJob = async (jobNumber: string) => {
    try {
      const token = localStorage.getItem('nexus_token') || 'mock-token';
      const res = await fetch(`${API_BASE_URL}/jobs/lookup/${encodeURIComponent(jobNumber)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const koshJobs = await res.json();
        if (koshJobs && koshJobs.length > 0) {
          // Use exact match first, else first result
          const match = koshJobs.find((j: Record<string, string>) => j.job_number === jobNumber) || koshJobs[0];
          setKoshJobData(match);
          setFormData(prev => ({
            ...prev,
            jobNumber: match.job_number,
            partDescription: match.description || prev.partDescription,
            customerName: match.customer || prev.customerName,
            customerCode: prev.customerCode,
            partNumber: match.cust_pn || prev.partNumber,
            quantity: match.order_qty || prev.quantity,
            revision: match.job_rev || prev.revision,
            customerRevision: match.cust_rev || prev.customerRevision,
          }));
          setWorkOrderPrefix(match.job_number);
          toast.success(`Found KOSH job "${match.job_number}" — customer: ${match.customer}. Select a traveler type to continue.`);
          return;
        }
      }
      toast.warning('No existing traveler or KOSH job found. Please select a type to create a new one.');
    } catch {
      toast.warning('No existing traveler found. Please select a type to create a new one.');
    }
  };

  // Handle ?job= query param (from Jobs page "Create Traveler" link)
  useEffect(() => {
    if (mode !== 'create') return;
    const params = new URLSearchParams(window.location.search);
    const jobParam = params.get('job');
    if (jobParam) {
      // Set the lookup input value and trigger KOSH job lookup
      const input = document.getElementById('job-number-lookup') as HTMLInputElement;
      if (input) input.value = jobParam;
      fillFromKoshJob(jobParam);
    }
  }, [mode]);

  // Auto-save draft state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [draftId, setDraftId] = useState<number | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedDataRef = useRef<string>('');

  // Refs for step rows to enable auto-scroll after reordering
  const stepRowRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  // Debounce timer for step sequence reordering
  const seqReorderTimeout = useRef<NodeJS.Timeout | null>(null);

  // Ref for abort controller to prevent race conditions in auto-populate
  const abortControllerRef = useRef<AbortController | null>(null);

  // Drag and drop sensors
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setFormSteps(prev => {
      const oldIndex = prev.findIndex(s => s.id === active.id);
      const newIndex = prev.findIndex(s => s.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      return reordered.map((step, idx) => ({ ...step, sequence: idx + 1 }));
    });
  };

  // Keep page at top when component mounts
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Fetch work centers from DB when traveler type changes, fallback to static
  useEffect(() => {
    if (!selectedType) return;
    const typeMap: Record<string, string> = { 'PCB_ASSEMBLY': 'PCB_ASSEMBLY', 'PCB': 'PCB', 'CABLE': 'CABLE', 'CABLES': 'CABLE', 'PURCHASING': 'PURCHASING', 'RMA_SAME': 'RMA_SAME', 'RMA_DIFF': 'RMA_DIFF', 'MODIFICATION': 'MODIFICATION' };
    const dbType = typeMap[selectedType] || selectedType;
    const fetchWC = async () => {
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`${API_BASE_URL}/work-centers-mgmt/?traveler_type=${dbType}`, {
          headers: { 'Authorization': `Bearer ${token || 'mock-token'}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.length > 0) {
            setDynamicWorkCenters(data.map((wc: any) => ({ name: wc.name, description: wc.description || '', code: wc.code || '' })));
            return;
          }
        }
      } catch { /* fallback to static */ }
      setDynamicWorkCenters(getWorkCentersByType(selectedType));
    };
    fetchWC();
  }, [selectedType]);

  const [isGeneratingWO, setIsGeneratingWO] = useState(false);
  // Guards against double-submit (double-click / slow tunnel) creating
  // duplicate travelers. Disables the Create/Update and Save-as-Draft buttons
  // while a save request is in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fetchNextWorkOrderNumber = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    try {
      if (!silent) setIsGeneratingWO(true);
      const response = await fetch(`${API_BASE_URL}/travelers/next-work-order-number`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('nexus_token') || 'mock-token'}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.next_work_order_prefix) {
          setWorkOrderPrefix(data.next_work_order_prefix);
          setWorkOrderSuffix('');
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

  // Fetch next sequential work order number on create mode. Skipped for clones:
  // cloned travelers stay WO-less until promoted to Awaiting Start so the
  // sequential WO isn't burned on drafts that may never ship.
  useEffect(() => {
    if (mode === 'create' && !initialData?.work_order_number && !isClone) {
      fetchNextWorkOrderNumber({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialData?.work_order_number, isClone]);

  // Sync workOrderNumber when prefix or suffix changes
  useEffect(() => {
    let fullWorkOrder = '';
    if (workOrderPrefix && workOrderSuffix) {
      fullWorkOrder = `${workOrderPrefix}-${workOrderSuffix}`;
    } else if (workOrderPrefix) {
      fullWorkOrder = workOrderPrefix;
    } else if (workOrderSuffix) {
      fullWorkOrder = workOrderSuffix; // Don't create "-suffix" if no prefix
    }
    setFormData(prev => ({ ...prev, workOrderNumber: fullWorkOrder }));
  }, [workOrderPrefix, workOrderSuffix]);

  // Debug: Monitor formSteps changes
  const prevStepsCountRef = useRef(0);
  useEffect(() => {
    const prevCount = prevStepsCountRef.current;
    const newCount = formSteps.length;

    if (newCount > prevCount) {
      console.log('📊 formSteps INCREASED:', prevCount, '→', newCount);
      if (newCount > 0) {
        console.log('   First step:', formSteps[0]);
      }
    } else if (newCount < prevCount) {
      console.warn('⚠️ formSteps DECREASED:', prevCount, '→', newCount, '- STEPS WERE CLEARED!');
    } else if (newCount > 0) {
      console.log('📊 formSteps updated (same count):', newCount);
    }

    prevStepsCountRef.current = newCount;
  }, [formSteps]);

  // Auto-save disabled - users save explicitly via "Create Traveler" or "Save as Draft" buttons

  const travelerTypes = [
    {
      value: 'PCB_ASSEMBLY',
      label: 'PCB Assembly',
      description: 'Full board assembly with components',
      gradient: 'from-blue-500 to-blue-700',
      hoverGradient: 'from-blue-600 to-blue-800',
      borderColor: 'border-blue-400',
      bgAccent: 'bg-blue-400/20',
      iconBg: 'bg-blue-400/30'
    },
    {
      value: 'PCB',
      label: 'PCB',
      description: 'Bare circuit board fabrication',
      gradient: 'from-green-500 to-green-700',
      hoverGradient: 'from-green-600 to-green-800',
      borderColor: 'border-green-400',
      bgAccent: 'bg-green-400/20',
      iconBg: 'bg-green-400/30'
    },
    {
      value: 'CABLE',
      label: 'Cables',
      description: 'Cable and wire harness assembly',
      gradient: 'from-purple-500 to-purple-700',
      hoverGradient: 'from-purple-600 to-purple-800',
      borderColor: 'border-purple-400',
      bgAccent: 'bg-purple-400/20',
      iconBg: 'bg-purple-400/30'
    },
    {
      value: 'PURCHASING',
      label: 'Purchasing',
      description: 'Parts and components procurement',
      gradient: 'from-orange-500 to-orange-700',
      hoverGradient: 'from-orange-600 to-orange-800',
      borderColor: 'border-orange-400',
      bgAccent: 'bg-orange-400/20',
      iconBg: 'bg-orange-400/30'
    },
    {
      value: 'RMA_SAME',
      label: 'RMA Router Same Job',
      description: 'RMA from same job or revision, PO or work order',
      gradient: 'from-red-500 to-red-700',
      hoverGradient: 'from-red-600 to-red-800',
      borderColor: 'border-red-400',
      bgAccent: 'bg-red-400/20',
      iconBg: 'bg-red-400/30'
    },
    {
      value: 'RMA_DIFF',
      label: 'RMA Router Diff Job',
      description: 'RMA from different jobs or revisions, POs or work orders',
      gradient: 'from-pink-500 to-pink-700',
      hoverGradient: 'from-pink-600 to-pink-800',
      borderColor: 'border-pink-400',
      bgAccent: 'bg-pink-400/20',
      iconBg: 'bg-pink-400/30'
    },
    {
      value: 'MODIFICATION',
      label: 'Modification, Rework or Repair',
      description: 'Board modification, rework or repair',
      gradient: 'from-amber-500 to-amber-700',
      hoverGradient: 'from-amber-600 to-amber-800',
      borderColor: 'border-amber-400',
      bgAccent: 'bg-amber-400/20',
      iconBg: 'bg-amber-400/30'
    }
  ];

  useEffect(() => {
    console.log('🔵 selectedType useEffect triggered | mode:', mode, '| selectedType:', selectedType);

    if (mode === 'edit' && initialData) {
      console.log('📝 EDIT mode - loading initial data');
      // Store the database ID for edit mode
      if (initialData.id) {
        setTravelerDbId(Number(initialData.id));
      }

      // Update formData with initialData values
      setFormData({
        jobNumber: String(initialData.job_number || ''),
        workOrderNumber: String(initialData.work_order_number || ''),
        partNumber: String(initialData.part_number || ''),
        partDescription: String(initialData.part_description || ''),
        revision: String(initialData.revision || ''),
        customerRevision: String(initialData.customer_revision || ''),
        partRevision: String(initialData.part_revision || ''),
        quantity: Number(initialData.quantity) || 0,
        customerCode: String(initialData.customer_code || ''),
        customerName: String(initialData.customer_name || ''),
        priority: (initialData.priority || 'NORMAL') as 'LOW' | 'NORMAL' | 'PREMIUM' | 'HIGH' | 'URGENT',
        notes: String(initialData.notes || ''),
        poNumber: String(initialData.po_number || ''),
        operation: '',
        pageNumber: '1',
        totalPages: '1',
        drawingNumber: '',
        specs: String(initialData.specs || ''),
        specsDate: '',
        fromStock: String(initialData.from_stock || ''),
        toStock: String(initialData.to_stock || ''),
        shipVia: String(initialData.ship_via || ''),
        lot: '',
        startDate: extractDateOnly(initialData.start_date || initialData.created_at),
        dueDate: extractDateOnly(initialData.due_date),
        shipDate: extractDateOnly(initialData.ship_date),
        comments: String(initialData.comments || '')
      });

      // Update work order prefix and suffix
      const workOrder = String(initialData.work_order_number || '');
      const { prefix, suffix } = splitWorkOrder(workOrder);
      setWorkOrderPrefix(prefix);
      setWorkOrderSuffix(suffix);

      // Load labor hours and active status
      if (typeof initialData.include_labor_hours === 'boolean') {
        setIncludeLaborHours(initialData.include_labor_hours);
      }
      if (typeof initialData.is_active === 'boolean') {
        setIsActive(initialData.is_active);
      }

      // Load existing steps for edit mode
      if (initialData.process_steps) {
        const existingSteps = (initialData.process_steps as Array<Record<string, unknown>>).map((step: Record<string, unknown>, index: number) => {
          // Extract just the date part (YYYY-MM-DD) from datetime strings
          let dateValue = '';
          if (step.completed_date) {
            const dateStr = String(step.completed_date);
            // Extract YYYY-MM-DD from ISO string or datetime
            const match = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
            dateValue = match ? match[0] : '';
          }

          return {
            id: String(step.id || index),
            sequence: Number(step.step_number),
            workCenter: String(step.operation),
            instruction: String(step.instructions || ''),
            quantity: Number(step.quantity || 0),
            rejected: Number(step.rejected || 0),
            accepted: Number(step.accepted || 0),
            assign: String(step.sign || ''),
            date: dateValue
          };
        });
        setFormSteps(existingSteps);
      }
      // Prevent page from scrolling when loading edit data
      setTimeout(() => window.scrollTo(0, 0), 0);
    } else if (selectedType && mode === 'create' && formSteps.length === 0) {
      // In create mode, load default steps ONLY if formSteps is empty (not already auto-populated)
      console.log('❌ LOADING DEFAULT STEPS for type:', selectedType);
      loadDefaultSteps(selectedType);
      // Set labor hours based on traveler type (only PCB doesn't have labor hours)
      setIncludeLaborHours(selectedType !== 'PCB');
      // Keep page at top when selecting type
      setTimeout(() => window.scrollTo(0, 0), 0);
    }
  }, [selectedType, mode, initialData]);

  // Auto-populate is now handled by onBlur/onKeyDown handlers on the job number input fields.
  // Those handlers fetch all work orders for the job, show a selector if multiple exist,
  // and always assign a NEW work order number (not the old one).

  const loadDefaultSteps = (type: TravelerType) => {
    // Pre-populate ALL work center steps for the selected type
    // User can then delete steps they don't need or add custom ones
    const workCenters = getWorkCentersByType(type);
    const defaultSteps: FormStep[] = workCenters.map((wc, index) => ({
      id: (index + 1).toString(),
      sequence: index + 1,
      workCenter: wc.name,
      instruction: '',
      quantity: 0,
      rejected: 0,
      accepted: 0,
      assign: '',
      date: ''
    }));

    setFormSteps(defaultSteps);
  };

  const handleTypeSelect = (type: TravelerType) => {
    setSelectedType(type);
    setShowForm(true);
  };

  const addNewStep = () => {
    const newStep: FormStep = {
      id: Date.now().toString(),
      sequence: formSteps.length + 1,
      workCenter: '',
      instruction: '',
      quantity: formData.quantity,
      rejected: 0,
      accepted: 0,
      assign: '',
      date: ''
    };
    setFormSteps([...formSteps, newStep]);
  };

  const removeStep = (id: string) => {
    const newSteps = formSteps.filter(step => step.id !== id);

    // Renumber remaining steps consecutively
    const renumberedSteps = newSteps.map((step, idx) => ({
      ...step,
      sequence: idx + 1
    }));

    setFormSteps(renumberedSteps);
  };

  const updateStep = (id: string, field: keyof FormStep, value: string | number) => {
    // If sequence number changed, update immediately but debounce the reorder (3s)
    if (field === 'sequence') {
      // Update the value immediately so user sees what they typed
      setFormSteps(prev => prev.map(step => step.id === id ? { ...step, sequence: Number(value) } : step));

      // Clear any pending reorder
      if (seqReorderTimeout.current) {
        clearTimeout(seqReorderTimeout.current);
      }

      // Reorder after 3 seconds of no changes
      seqReorderTimeout.current = setTimeout(() => {
        setFormSteps(prev => {
          const targetSequence = Number(value);
          const movingStep = prev.find(step => step.id === id);
          if (!movingStep) return prev;

          const otherSteps = prev.filter(step => step.id !== id);
          const insertIndex = Math.max(0, Math.min(targetSequence - 1, otherSteps.length));
          const reorderedSteps = [
            ...otherSteps.slice(0, insertIndex),
            movingStep,
            ...otherSteps.slice(insertIndex)
          ];

          const renumberedSteps = reorderedSteps.map((step, idx) => ({
            ...step,
            sequence: idx + 1
          }));

          // Scroll to the step at the target position
          setTimeout(() => {
            const targetStep = renumberedSteps[Math.min(targetSequence - 1, renumberedSteps.length - 1)];
            if (targetStep) {
              const stepElement = stepRowRefs.current[targetStep.id];
              if (stepElement) {
                stepElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                stepElement.style.backgroundColor = '#dbeafe';
                setTimeout(() => {
                  stepElement.style.backgroundColor = '';
                }, 1500);
              }
            }
          }, 100);

          return renumberedSteps;
        });
      }, 3000);
    } else {
      // For all other fields, just update normally
      const newSteps = formSteps.map(step =>
        step.id === id ? { ...step, [field]: value } : step
      );
      setFormSteps(newSteps);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return; // prevent double-submit creating duplicate travelers
    // Clones intentionally save without a WO — the WO is allocated when the
    // traveler later transitions Draft → Awaiting Start. Don't block the
    // save just because the WO field is empty in clone mode.
    const woRequired = !isClone;
    if (!formData.jobNumber || !formData.partNumber || (woRequired && !formData.workOrderNumber)) {
      const missing: string[] = [];
      if (!formData.jobNumber) missing.push('Job Number');
      if (woRequired && !formData.workOrderNumber) missing.push('Work Order Number');
      if (!formData.partNumber) missing.push('Part Number');
      toast.warning(`Missing Required Fields: Please fill in ${missing.join(', ')}`);
      return;
    }

    // Check if form was auto-populated and revision hasn't been changed
    if (mode === 'create' && wasAutoPopulated && formData.revision === autoPopulatedRevision) {
      toast.warning('BOM Revision Not Changed: This was auto-populated from BOM Rev ' + autoPopulatedRevision + '. You MUST change the BOM Revision before saving.');
      return;
    }

    // Build full job number with compliance indicators
    let fullJobNumber = formData.jobNumber;
    if (isLeadFree) fullJobNumber += 'L';
    if (isITAR) fullJobNumber += 'M';

    // Map traveler type to backend enum - ONLY 4 types
    const travelerTypeMap: { [key: string]: string } = {
      'PCB_ASSEMBLY': 'PCB_ASSEMBLY',
      'PCB': 'PCB',
      'CABLE': 'CABLE',
      'PURCHASING': 'PURCHASING'
    };

    // PCB travelers should never have labor hours
    const finalIncludeLaborHours = (selectedType === 'PCB') ? false : includeLaborHours;

    // BOM Rev is manual-only. Persist whatever the user typed in the form.
    const finalRevision = formData.revision || String(initialData?.revision || 'A');

    // Prepare API payload. Clones persist an empty WO — it's filled later when
    // the status transitions Draft → Awaiting Start.
    const travelerData = {
      job_number: fullJobNumber,
      work_order_number: isClone ? (formData.workOrderNumber || '') : (formData.workOrderNumber || fullJobNumber),
      po_number: formData.poNumber || '',
      traveler_type: travelerTypeMap[selectedType] || 'PCB_ASSEMBLY',
      part_number: formData.partNumber,
      part_description: formData.partDescription || 'Assembly',
      revision: finalRevision,
      customer_revision: formData.customerRevision || '',
      part_revision: formData.partRevision || '',
      quantity: parseInt(formData.quantity.toString()) || 1,
      customer_code: formData.customerCode || '',
      customer_name: formData.customerName || '',
      priority: formData.priority || 'NORMAL',
      work_center: formSteps[0]?.workCenter || 'ASSEMBLY',
      // Clones start as DRAFT so the WO is only burned on the Draft →
      // Awaiting Start transition (handled server-side in PATCH /travelers/{id}).
      status: isClone ? 'DRAFT' : 'CREATED',
      is_active: true,
      include_labor_hours: finalIncludeLaborHours,
      notes: formData.notes || '',
      specs: formData.specs || '',
      specs_date: formData.specsDate || '',
      from_stock: formData.fromStock || '',
      to_stock: formData.toStock || '',
      ship_via: formData.shipVia || '',
      comments: formData.comments || '',
      start_date: formData.startDate || '',
      due_date: formData.dueDate || '',
      ship_date: formData.shipDate || formData.dueDate || '',
      process_steps: formSteps.map(step => ({
        step_number: step.sequence,
        operation: step.workCenter,
        work_center_code: dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.code || step.workCenter.replace(/\s+/g, '_').toUpperCase(),
        instructions: step.instruction || '',
        estimated_time: 30,
        is_required: true,
        quantity: step.quantity || null,
        accepted: step.accepted || null,
        rejected: step.rejected || null,
        sign: step.assign || null,
        completed_date: step.date || null,
        sub_steps: []
      })),
      manual_steps: []
    };

    console.log('Submitting traveler data:', JSON.stringify(travelerData, null, 2));

    setIsSubmitting(true);
    try {
      // Call API to create or update traveler
      // Use draftId if available (from auto-save), otherwise use existing ID for edit mode
      const existingId = draftId || travelerDbId || (mode === 'edit' ? travelerId : null);
      const url = existingId
        ? `${API_BASE_URL}/travelers/${existingId}`
        : `${API_BASE_URL}/travelers/`;
      const method = existingId ? 'PUT' : 'POST';

      console.log(`Making ${method} request to ${url}`);

      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('nexus_token') || 'mock-token'}`
        },
        body: JSON.stringify(travelerData)
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response body:', responseText);

      if (!response.ok) {
        let errorMessage = `Failed to ${mode === 'edit' ? 'update' : 'create'} traveler`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.detail || errorMessage;
        } catch {
          errorMessage = responseText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = JSON.parse(responseText);
      console.log('Traveler saved successfully:', result);

      const action = mode === 'create' ? 'Created' : 'Updated';
      const complianceInfo = [];
      if (isLeadFree) complianceInfo.push('🟢 Lead Free (RoHS)');
      if (isITAR) complianceInfo.push('⚠️ ITAR Controlled');

      toast.success(`Traveler ${action} Successfully! Job: ${fullJobNumber} | Part: ${formData.partNumber}`);

      // Redirect to the created/updated traveler's detail page
      setTimeout(() => {
        const travelerId = result.id || result.traveler_id;
        if (travelerId) {
          window.location.href = `/travelers/${travelerId}`;
        } else {
          window.location.href = '/travelers';
        }
      }, 1500);
    } catch (error: unknown) {
      console.error('Error saving traveler:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Error ${mode === 'edit' ? 'Updating' : 'Creating'} Traveler: ${errorMessage}`);
      setIsSubmitting(false); // re-enable on failure; on success we redirect
    }
  };

  const handleSaveDraft = async () => {
    if (isSubmitting) return; // prevent double-submit creating duplicate drafts
    if (!formData.jobNumber) {
      toast.warning('Job Number Required: Please enter a Job Number to save as draft.');
      return;
    }

    // Build full job number with compliance indicators
    let fullJobNumber = formData.jobNumber;
    if (isLeadFree) fullJobNumber += 'L';
    if (isITAR) fullJobNumber += 'M';

    // Construct work order number from prefix and suffix. Drafts persist
    // whatever the user typed — if they left WO empty we keep it empty so
    // the WO is only allocated on the Draft → Awaiting Start transition.
    let fullWorkOrderNumber = '';
    if (workOrderPrefix && workOrderSuffix) {
      fullWorkOrderNumber = `${workOrderPrefix}-${workOrderSuffix}`;
    } else if (workOrderPrefix) {
      fullWorkOrderNumber = workOrderPrefix;
    } else if (workOrderSuffix) {
      fullWorkOrderNumber = workOrderSuffix;
    } else {
      fullWorkOrderNumber = formData.workOrderNumber || '';
    }

    // Map traveler type to backend enum
    const travelerTypeMap: { [key: string]: string } = {
      'PCB_ASSEMBLY': 'PCB_ASSEMBLY',
      'PCB': 'PCB',
      'CABLE': 'CABLE',
      'PURCHASING': 'PURCHASING'
    };

    // Prepare API payload with DRAFT status
    const travelerData = {
      job_number: fullJobNumber,
      work_order_number: fullWorkOrderNumber,
      po_number: formData.poNumber || '',
      traveler_type: travelerTypeMap[selectedType] || 'PCB_ASSEMBLY',
      part_number: formData.partNumber || '',
      part_description: formData.partDescription || '',
      revision: formData.revision || 'A',
      customer_revision: formData.customerRevision || '',
      part_revision: formData.partRevision || '',
      quantity: parseInt(formData.quantity.toString()) || 1,
      customer_code: formData.customerCode || '',
      customer_name: formData.customerName || '',
      priority: formData.priority || 'NORMAL',
      work_center: formSteps[0]?.workCenter || 'ASSEMBLY',
      status: 'DRAFT',  // Set status to DRAFT
      is_active: false,  // Drafts are not active
      include_labor_hours: false,
      notes: formData.notes || '',
      specs: formData.specs || '',
      specs_date: formData.specsDate || '',
      from_stock: formData.fromStock || '',
      to_stock: formData.toStock || '',
      ship_via: formData.shipVia || '',
      comments: formData.comments || '',
      start_date: formData.startDate || '',
      due_date: formData.dueDate || '',
      ship_date: formData.shipDate || '',
      process_steps: formSteps.map(step => ({
        step_number: step.sequence,
        operation: step.workCenter,
        work_center_code: dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.code || step.workCenter.replace(/\s+/g, '_').toUpperCase(),
        instructions: step.instruction || '',
        estimated_time: 30,
        is_required: true,
        quantity: step.quantity || null,
        accepted: step.accepted || null,
        rejected: step.rejected || null,
        sign: step.assign || '',
        completed_date: step.date || ''
      }))
    };

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('nexus_token');
      // Use existing draft ID if available (from auto-save), otherwise create new or edit existing
      const existingId = draftId || (mode === 'edit' ? travelerId : null);
      const url = existingId
        ? `${API_BASE_URL}/travelers/${existingId}`
        : `${API_BASE_URL}/travelers/`;

      const method = existingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(travelerData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText);
        throw new Error(`Server returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('Draft saved successfully:', result);

      // Update draftId if this was a new draft
      if (!draftId && result.id) {
        setDraftId(result.id);
      }

      toast.success(`Draft Saved Successfully! Job: ${fullJobNumber} | Status: DRAFT`);

      // Redirect to the saved draft's detail page
      setTimeout(() => {
        const travelerId = result.id || draftId;
        if (travelerId) {
          window.location.href = `/travelers/${travelerId}`;
        } else {
          window.location.href = '/travelers';
        }
      }, 1500);
    } catch (error: unknown) {
      console.error('Error saving draft:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Error Saving Draft: ${errorMessage}`);
      setIsSubmitting(false); // re-enable on failure; on success we redirect
    }
  };

  // Shared auto-fill function used by both type selection screen and job number field
  const autoFillFromExisting = async (fullData: FullTravelerData) => {
    // BOM Rev is manual-only — carry the source revision through unchanged
    // and let the user edit it before saving.
    const oldRevision = String(fullData.revision || 'A');
    const newRevision = oldRevision;

    // Parse specs
    let specsText = '';
    try {
      const specsData = fullData.specs;
      if (specsData) {
        if (typeof specsData === 'string') {
          const parsed = JSON.parse(specsData);
          if (Array.isArray(parsed)) {
            specsText = parsed.map((spec: Record<string, unknown>) => String(spec.text || '')).join('\n');
          } else {
            specsText = specsData;
          }
        } else if (Array.isArray(specsData)) {
          specsText = (specsData as Record<string, unknown>[]).map((spec: Record<string, unknown>) => String(spec.text || '')).join('\n');
        }
      }
    } catch {
      specsText = String(fullData.specs || '');
    }

    // For clones, skip WO allocation entirely — it is assigned later on
    // Draft → Awaiting Start. For non-clone autofill (new revision of an
    // existing job), fetch a fresh sequential WO as before.
    if (isClone) {
      setWorkOrderPrefix('');
      setWorkOrderSuffix('');
    } else {
      try {
        const response = await fetch(`${API_BASE_URL}/travelers/next-work-order-number`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('nexus_token') || 'mock-token'}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.next_work_order_prefix) {
            setWorkOrderPrefix(data.next_work_order_prefix);
            setWorkOrderSuffix('');
          }
        }
      } catch {
        // Fallback: use existing work order if fetch fails
        if (fullData.work_order_number) {
          const { prefix, suffix } = splitWorkOrder(fullData.work_order_number);
          setWorkOrderPrefix(prefix);
          setWorkOrderSuffix(suffix);
        }
      }
    }

    // Auto-populate ALL fields
    setFormData(prev => ({
      ...prev,
      jobNumber: fullData.job_number || prev.jobNumber,
      poNumber: fullData.po_number || '',
      partNumber: fullData.part_number || '',
      partDescription: fullData.part_description || '',
      revision: newRevision,
      customerRevision: fullData.customer_revision || '',
      partRevision: fullData.part_revision || '',
      quantity: fullData.quantity || 0,
      customerCode: fullData.customer_code || '',
      customerName: fullData.customer_name || '',
      priority: (fullData.priority || 'NORMAL') as 'LOW' | 'NORMAL' | 'PREMIUM' | 'HIGH' | 'URGENT',
      specs: specsText,
      fromStock: fullData.from_stock || '',
      toStock: fullData.to_stock || '',
      shipVia: fullData.ship_via || '',
      dueDate: extractDateOnly(fullData.due_date),
      shipDate: extractDateOnly(fullData.ship_date),
      comments: fullData.comments || ''
    }));

    // Set traveler type and show form
    if (fullData.traveler_type) {
      setSelectedType(fullData.traveler_type as TravelerType);
    }

    // Set flags
    setIsLeadFree(fullData.is_lead_free || false);
    setIsITAR(fullData.is_itar || false);
    setIncludeLaborHours(fullData.include_labor_hours || false);

    // Auto-populate process steps
    if (fullData.process_steps && fullData.process_steps.length > 0) {
      const newSteps = fullData.process_steps.map((step: ProcessStepData, index: number) => ({
        id: `step-${Date.now()}-${index}`,
        sequence: step.step_number,
        workCenter: step.operation || step.work_center_code || '',
        instruction: step.instructions || '',
        quantity: 0,
        rejected: 0,
        accepted: 0,
        assign: '',
        date: ''
      }));
      setFormSteps(newSteps);
    }

    // Store revision info for validation
    setAutoPopulatedRevision(newRevision);
    setWasAutoPopulated(true);

    // Show the form
    setShowForm(true);

    toast.info(`Auto-filled from existing traveler (BOM Rev ${oldRevision}). BOM Rev set to ${newRevision}. Please verify Customer Rev and BOM Rev.`);
    setTimeout(() => window.scrollTo(0, 0), 0);
  };

  // If type not selected, show type selection
  if (!showForm) {
    return (
      <div className="h-[calc(100vh-6rem)] bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 flex flex-col items-center justify-center -m-4 sm:-m-4 rounded-xl overflow-hidden">
        <div className="w-full max-w-3xl px-4">
          {/* Header */}
          <div className="mb-4 bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 text-white rounded-2xl p-5 md:p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
            </div>
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="bg-white/15 backdrop-blur-sm p-3 rounded-xl border border-white/20 mb-3">
                <svg className="w-7 h-7 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-1">Select Traveler Type</h1>
              <p className="text-sm text-teal-200/80">Choose the type that matches your manufacturing process</p>
            </div>
          </div>

          {/* Job Number Lookup */}
          <div className="mb-4 bg-white dark:bg-slate-800 rounded-xl border-2 border-indigo-200 dark:border-slate-600 p-4 shadow-sm">
            <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">
              Have an existing Job Number? Enter it to auto-fill:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="job-number-lookup"
                placeholder="Enter job number (e.g. test1, 8744 PARTS)"
                className="flex-1 border-2 border-gray-300 dark:border-slate-600 rounded-lg px-4 py-2.5 text-sm font-bold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const value = (e.target as HTMLInputElement).value.trim();
                    if (!value) return;
                    try {
                      const token = localStorage.getItem('nexus_token') || 'mock-token';
                      const response = await fetch(`${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(value)}/all-work-orders`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                      });
                      if (response.ok) {
                        const allWorkOrders: FullTravelerData[] = await response.json();
                        if (allWorkOrders && allWorkOrders.length > 1) {
                          setExistingWorkOrders(allWorkOrders);
                          setLookupTerm(value);
                          setShowWorkOrderSelector(true);
                          toast.info(`Found ${allWorkOrders.length} travelers for "${value}". Please select one to auto-fill from.`);
                        } else if (allWorkOrders && allWorkOrders.length === 1) {
                          autoFillFromExisting(allWorkOrders[0]);
                        } else {
                          // No NEXUS travelers — try KOSH job lookup
                          await fillFromKoshJob(value);
                        }
                      } else {
                        // No NEXUS travelers — try KOSH job lookup
                        await fillFromKoshJob(value);
                      }
                    } catch {
                      toast.error('Error looking up job number.');
                    }
                  }
                }}
                onBlur={async (e) => {
                  const value = e.target.value.trim();
                  if (!value || value.length < 2) return;
                  try {
                    const token = localStorage.getItem('nexus_token') || 'mock-token';
                    const response = await fetch(`${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(value)}/all-work-orders`, {
                      headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                      const allWorkOrders: FullTravelerData[] = await response.json();
                      if (allWorkOrders && allWorkOrders.length > 1) {
                        setExistingWorkOrders(allWorkOrders);
                        setLookupTerm(value);
                        setShowWorkOrderSelector(true);
                        toast.info(`Found ${allWorkOrders.length} travelers for "${value}". Please select one.`);
                      } else if (allWorkOrders && allWorkOrders.length === 1) {
                        autoFillFromExisting(allWorkOrders[0]);
                      } else {
                        // No NEXUS travelers — try KOSH job lookup silently
                        await fillFromKoshJob(value);
                      }
                    }
                  } catch { /* silent */ }
                }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Press Enter or tab out to search. Checks existing travelers first, then KOSH inventory jobs.</p>
          </div>

          {/* Work Order Selector Modal */}
          {showWorkOrderSelector && existingWorkOrders.length > 0 && (
            <div className="mb-4 bg-white dark:bg-slate-800 rounded-xl border-2 border-amber-300 dark:border-amber-600 p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">
                  {new Set(existingWorkOrders.map(w => w.job_number)).size > 1 ? (
                    <>Multiple Jobs Found for: <span className="text-indigo-600 dark:text-indigo-400">{lookupTerm}</span></>
                  ) : (
                    <>Multiple Work Orders Found for Job: <span className="text-indigo-600 dark:text-indigo-400">{existingWorkOrders[0]?.job_number}</span></>
                  )}
                </h3>
                <button
                  onClick={() => { setShowWorkOrderSelector(false); setExistingWorkOrders([]); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 text-lg font-bold"
                >
                  &times;
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Select which work order to auto-fill from. A new work order number will be assigned automatically.</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {existingWorkOrders.map((wo) => (
                  <button
                    key={wo.id}
                    onClick={() => {
                      autoFillFromExisting(wo);
                      setShowWorkOrderSelector(false);
                      setExistingWorkOrders([]);
                    }}
                    className="w-full text-left p-3 rounded-lg border-2 border-gray-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm text-gray-800 dark:text-slate-200">Job: {wo.job_number}</span>
                        <span className="ml-2 font-bold text-sm text-gray-800 dark:text-slate-200">WO: {wo.work_order_number}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">BOM Rev: {wo.revision}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">| {wo.traveler_type}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        wo.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                        wo.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{wo.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                      Part: {wo.part_number} - {wo.part_description} | Qty: {wo.quantity}
                      {wo.work_center && ` | WC: ${wo.work_center}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cards Grid - 2x2 */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-3">
            {/* PCB Assembly */}
            <button
              onClick={() => handleTypeSelect('PCB_ASSEMBLY' as TravelerType)}
              className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-blue-700"></div>
              <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 p-4 sm:p-5 flex flex-col items-center text-center">
                <div className="bg-white/15 backdrop-blur-sm p-3 sm:p-3.5 rounded-xl border border-white/20 mb-3 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-8 h-8 sm:w-9 sm:h-9 text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                  </svg>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-0.5">PCB Assembly</h3>
                <p className="text-[11px] sm:text-xs text-white/70">Board assembly with components</p>
                <div className="mt-2.5 flex items-center gap-1 text-white/50 group-hover:text-white transition-colors duration-300">
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Select</span>
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </button>

            {/* PCB */}
            <button
              onClick={() => handleTypeSelect('PCB' as TravelerType)}
              className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-emerald-700"></div>
              <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 p-4 sm:p-5 flex flex-col items-center text-center">
                <div className="bg-white/15 backdrop-blur-sm p-3 sm:p-3.5 rounded-xl border border-white/20 mb-3 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-8 h-8 sm:w-9 sm:h-9 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m3-2v2m3-2v2M9 19v2m3-2v2m3-2v2M3 9h2m-2 3h2m-2 3h2M19 9h2m-2 3h2m-2 3h2M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h3v3H8zM13 12h3v3h-3z" />
                  </svg>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-0.5">PCB</h3>
                <p className="text-[11px] sm:text-xs text-white/70">Bare circuit board fabrication</p>
                <div className="mt-2.5 flex items-center gap-1 text-white/50 group-hover:text-white transition-colors duration-300">
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Select</span>
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </button>

            {/* Cables */}
            <button
              onClick={() => handleTypeSelect('CABLE' as TravelerType)}
              className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-violet-700"></div>
              <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 p-4 sm:p-5 flex flex-col items-center text-center">
                <div className="bg-white/15 backdrop-blur-sm p-3 sm:p-3.5 rounded-xl border border-white/20 mb-3 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-8 h-8 sm:w-9 sm:h-9 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v4M10 3v4M7 17v4M10 17v4M5 7h7a1 1 0 011 1v1a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1zM5 15h7a1 1 0 011 1v1a1 1 0 01-1 1H5a1 1 0 01-1-1v-1a1 1 0 011-1zM13 8.5c2 0 3 1.5 3 3.5s-1 3.5-3 3.5" />
                  </svg>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-0.5">Cables</h3>
                <p className="text-[11px] sm:text-xs text-white/70">Wire harness assembly</p>
                <div className="mt-2.5 flex items-center gap-1 text-white/50 group-hover:text-white transition-colors duration-300">
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Select</span>
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </button>

            {/* Purchasing */}
            <button
              onClick={() => handleTypeSelect('PURCHASING' as TravelerType)}
              className="group relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transform hover:scale-[1.02] transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-amber-700"></div>
              <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 p-4 sm:p-5 flex flex-col items-center text-center">
                <div className="bg-white/15 backdrop-blur-sm p-3 sm:p-3.5 rounded-xl border border-white/20 mb-3 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-8 h-8 sm:w-9 sm:h-9 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4M17 12h4M7 8v8h10V8H7z" />
                    <line x1="9.5" y1="10" x2="9.5" y2="14" />
                    <line x1="12" y1="10" x2="12" y2="14" />
                    <line x1="14.5" y1="10" x2="14.5" y2="14" />
                  </svg>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-white mb-0.5">Purchasing</h3>
                <p className="text-[11px] sm:text-xs text-white/70">Parts & components procurement</p>
                <div className="mt-2.5 flex items-center gap-1 text-white/50 group-hover:text-white transition-colors duration-300">
                  <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">Select</span>
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </button>
          </div>

          {/* Back Button */}
          <div className="text-center">
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors duration-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to Travelers
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Debug: Log render state
  console.log('🎨 RENDER: formSteps.length =', formSteps.length, '| selectedType =', selectedType);

  // Main form
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-2 sm:p-4 lg:p-6 overflow-x-hidden">
      <div className="w-full max-w-7xl mx-auto overflow-x-hidden">
        {/* Header with Type Badge - NO PRINT */}
        <div className="bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 shadow-2xl rounded-2xl p-4 sm:p-5 md:p-8 mb-3 sm:mb-4 md:mb-6 no-print relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:space-x-4">
              <span className="px-3 py-2 bg-white text-indigo-700 rounded-lg font-bold shadow-md text-sm md:text-base">
                {travelerTypes.find(t => t.value === selectedType)?.label}
              </span>
              <div>
                <h2 className="text-xl md:text-2xl font-extrabold tracking-tight text-white">Traveler Form</h2>
                <p className="text-sm text-teal-200/80 mt-0.5">Fill in all required fields</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm(false)}
              className="w-full sm:w-auto px-4 py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-xl font-semibold transition-colors border border-white/20 text-sm md:text-base"
            >
              Change Type
            </button>
          </div>
        </div>

        {/* Action Buttons - Top of Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6 no-print">
          <button
            onClick={handleSaveDraft}
            disabled={isSubmitting}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>💾 Save as Draft</span>
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{isSubmitting ? 'Saving…' : (mode === 'create' ? 'Create Traveler' : 'Update Traveler')}</span>
          </button>
        </div>

        {/* Main Form - Page 1 */}
        <div className="bg-white dark:bg-slate-800 shadow-lg rounded-lg border-2 border-indigo-100 dark:border-slate-700 p-3 sm:p-4 md:p-6 lg:p-8 mb-3 sm:mb-4 md:mb-6">
          {/* Top Row - Responsive */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 mb-3 sm:mb-4 md:mb-6">
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">
                Job No * {isLeadFree && <span className="text-green-600">(L)</span>}{isITAR && <span className="text-red-600">(M)</span>}
              </label>
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  value={formData.jobNumber}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData({...formData, jobNumber: value});
                  }}
                  onBlur={async (e) => {
                    const value = e.target.value.trim();
                    if (value.length >= 2 && mode === 'create') {
                      try {
                        const token = localStorage.getItem('nexus_token') || 'mock-token';
                        const response = await fetch(`${API_BASE_URL}/travelers/by-job-number/${encodeURIComponent(value)}/all-work-orders`, {
                          headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (response.ok) {
                          const allWorkOrders: FullTravelerData[] = await response.json();
                          if (allWorkOrders && allWorkOrders.length > 1) {
                            setExistingWorkOrders(allWorkOrders);
                            setLookupTerm(value);
                            setShowWorkOrderSelector(true);
                            toast.info(`Found ${allWorkOrders.length} travelers for "${value}". Select one to auto-fill.`);
                          } else if (allWorkOrders && allWorkOrders.length === 1) {
                            autoFillFromExisting(allWorkOrders[0]);
                          }
                        }
                      } catch (error) {
                        console.error('Error fetching traveler data:', error);
                      }
                    }
                  }}
                  className="flex-1 min-w-0 border-2 border-blue-300 dark:border-blue-600 rounded px-2 py-1.5 text-xs sm:text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="8414"
                />
                {isLeadFree && <span className="flex-shrink-0 px-2 py-1.5 bg-green-100 text-green-800 font-bold rounded text-xs border border-green-300">L</span>}
                {isITAR && <span className="flex-shrink-0 px-2 py-1.5 bg-purple-100 text-purple-800 font-bold rounded text-xs border border-purple-300">M</span>}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Work Order *</label>
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  value={workOrderPrefix}
                  onChange={(e) => setWorkOrderPrefix(e.target.value)}
                  className="flex-1 min-w-0 border-2 border-blue-300 dark:border-blue-600 rounded px-2 py-1.5 text-xs sm:text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="26030"
                  title="Work order prefix (editable)"
                />
                <span className="text-gray-600 dark:text-slate-400 font-bold flex-shrink-0 text-xs sm:text-sm">-</span>
                <input
                  type="text"
                  value={workOrderSuffix}
                  onChange={(e) => setWorkOrderSuffix(e.target.value)}
                  className="w-14 sm:w-16 md:w-20 flex-shrink-0 border-2 border-blue-300 dark:border-blue-600 rounded px-1 sm:px-2 py-1.5 text-xs sm:text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="1"
                  title="Work order suffix"
                />
                <button
                  type="button"
                  onClick={() => fetchNextWorkOrderNumber()}
                  disabled={isGeneratingWO}
                  title="Generate next sequential work order number"
                  className="flex-shrink-0 px-2 py-1.5 text-xs sm:text-sm font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded border-2 border-blue-700 disabled:cursor-not-allowed transition-colors"
                >
                  {isGeneratingWO ? '…' : 'Generate'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                className="w-full min-w-0 border-2 border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-xs sm:text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Ship Date</label>
              <input
                type="date"
                value={formData.shipDate}
                onChange={(e) => setFormData({...formData, shipDate: e.target.value})}
                className="w-full min-w-0 border-2 border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-xs sm:text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Due Date</label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                className="w-full min-w-0 border-2 border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-xs sm:text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Work Order Selector - shown when job has multiple work orders */}
          {showWorkOrderSelector && existingWorkOrders.length > 0 && (
            <div className="mb-3 sm:mb-4 md:mb-6 bg-amber-50 dark:bg-amber-900/20 rounded-xl border-2 border-amber-300 dark:border-amber-600 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800 dark:text-slate-200">
                  {new Set(existingWorkOrders.map(w => w.job_number)).size > 1 ? (
                    <>Select Traveler for: <span className="text-indigo-600 dark:text-indigo-400">{lookupTerm}</span></>
                  ) : (
                    <>Select Work Order for Job: <span className="text-indigo-600 dark:text-indigo-400">{existingWorkOrders[0]?.job_number}</span></>
                  )}
                </h3>
                <button
                  onClick={() => { setShowWorkOrderSelector(false); setExistingWorkOrders([]); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 text-lg font-bold px-2"
                >
                  &times;
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Multiple work orders exist for this job. Select one to auto-fill from (a new work order number will be assigned).</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {existingWorkOrders.map((wo) => (
                  <button
                    key={wo.id}
                    onClick={() => {
                      autoFillFromExisting(wo);
                      setShowWorkOrderSelector(false);
                      setExistingWorkOrders([]);
                    }}
                    className="w-full text-left p-3 rounded-lg border-2 border-gray-200 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all bg-white dark:bg-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm text-gray-800 dark:text-slate-200">Job: {wo.job_number}</span>
                        <span className="ml-2 font-bold text-sm text-gray-800 dark:text-slate-200">WO: {wo.work_order_number}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">BOM Rev: {wo.revision}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">| {wo.traveler_type}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        wo.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                        wo.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{wo.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                      Part: {wo.part_number} - {wo.part_description} | Qty: {wo.quantity}
                      {wo.work_center && ` | WC: ${wo.work_center}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Customer and Part Info */}
          <div className="space-y-3 sm:space-y-4 mb-3 sm:mb-4 md:mb-6">
            {/* Row 1: Customer Code + Quantity */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Customer Code</label>
                <input
                  type="text"
                  value={formData.customerCode}
                  onChange={(e) => { if (acceptCustomerCode(e.target.value, formData.customerCode || '')) setFormData({...formData, customerCode: e.target.value}); }}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="750"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Quantity *</label>
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                  className="w-full border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="250"
                />
              </div>
            </div>

            {/* Row 2: Customer Name + PO Number (side by side) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Customer Name</label>
                <input
                  type="text"
                  value={formData.customerName}
                  onChange={(e) => setFormData({...formData, customerName: e.target.value})}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="ACME Corporation"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">PO Number</label>
                <input
                  type="text"
                  value={formData.poNumber}
                  onChange={(e) => setFormData({...formData, poNumber: e.target.value})}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="PO-12345"
                />
              </div>
            </div>

            {/* Row 3: Part No + Part Description (side by side) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Part No *</label>
                <input
                  type="text"
                  value={formData.partNumber}
                  onChange={(e) => setFormData({...formData, partNumber: e.target.value})}
                  className="w-full border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="METSHIFT"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Part Description *</label>
                <input
                  type="text"
                  value={formData.partDescription}
                  onChange={(e) => setFormData({...formData, partDescription: e.target.value})}
                  className="w-full border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="METSHIFT Assembly"
                />
              </div>
            </div>

            {/* Row 4: BOM Revision + Customer Revision (side by side) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">BOM Revision</label>
                <input
                  type="text"
                  value={formData.revision}
                  onChange={(e) => {
                    setFormData({...formData, revision: e.target.value});
                    if (wasAutoPopulated && e.target.value !== autoPopulatedRevision) {
                      setWasAutoPopulated(false);
                    }
                  }}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="A"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Customer Revision</label>
                <input
                  type="text"
                  value={formData.customerRevision}
                  onChange={(e) => setFormData({...formData, customerRevision: e.target.value})}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="REV A"
                />
              </div>
            </div>

            {/* Row 5: Priority */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: e.target.value as 'LOW' | 'NORMAL' | 'PREMIUM' | 'HIGH' | 'URGENT'})}
                  className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 md:px-4 py-2 md:py-3 text-sm md:text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="PREMIUM">Premium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3 md:gap-4 mb-3 sm:mb-4 md:mb-6 p-2 sm:p-3 md:p-5 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-700 dark:to-slate-700 rounded-lg border-2 border-indigo-200 dark:border-slate-600 shadow-sm">
            {/* Only show labor hours option for non-PCB travelers */}
            {selectedType !== 'PCB' && (
              <div className={`flex items-center space-x-4 p-3 rounded border-2 transition-all ${includeLaborHours ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600'}`}>
                <input
                  type="checkbox"
                  id="includeLaborHours"
                  checked={includeLaborHours}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    setIncludeLaborHours(newValue);
                    if (newValue) {
                      toast.success('Labor Hours Table will be included in this traveler!');
                    }
                  }}
                  className="w-5 h-5 text-blue-600 border border-gray-300 rounded cursor-pointer"
                />
                <label htmlFor="includeLaborHours" className="flex-1 cursor-pointer">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-slate-100 text-sm md:text-base">Include Labor Hours Table</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {includeLaborHours ? '✓ Labor tracking enabled' : 'Add labor tracking section'}
                    </p>
                  </div>
                </label>
              </div>
            )}

            <div className={`flex items-center space-x-4 p-3 rounded border-2 transition-all ${isActive ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : 'bg-gray-50 dark:bg-slate-800 border-gray-300 dark:border-slate-600'}`}>
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setIsActive(newValue);
                  if (newValue) {
                    toast.success('Traveler will be marked as ACTIVE');
                  } else {
                    toast.warning('Traveler will be marked as INACTIVE');
                  }
                }}
                className="w-5 h-5 text-blue-600 border border-gray-300 rounded cursor-pointer"
              />
              <label htmlFor="isActive" className="flex-1 cursor-pointer">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-slate-100 text-sm md:text-base">Active Traveler</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Mark as active in production</p>
                </div>
              </label>
            </div>
          </div>

          {/* Specifications - Prominent Section with Date */}
          <div className="mb-3 sm:mb-4 md:mb-6 p-2 sm:p-3 md:p-5 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg border-2 border-yellow-200 dark:border-yellow-800 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 mb-3">
              <label className="block text-sm md:text-base font-bold text-gray-900 dark:text-slate-100">Specifications</label>
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <label className="text-xs md:text-sm font-semibold text-gray-700 dark:text-slate-300">Date:</label>
                <input
                  type="date"
                  value={formData.specsDate}
                  onChange={(e) => setFormData({...formData, specsDate: e.target.value})}
                  className="flex-1 sm:flex-none border border-gray-300 dark:border-slate-600 rounded px-2 md:px-3 py-1.5 text-sm focus:border-blue-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                />
              </div>
            </div>
            <textarea
              value={formData.specs}
              onChange={(e) => setFormData({...formData, specs: e.target.value})}
              className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 md:px-4 py-2 md:py-3 text-sm md:text-base text-gray-900 dark:text-slate-100 focus:border-blue-500 min-h-[100px] md:min-h-[120px] resize-y bg-white dark:bg-slate-700"
              placeholder="Enter specifications, notes, and special requirements..."
            />
          </div>

          {/* Stock and Shipping Info */}
          <div className="mb-3 sm:mb-4 md:mb-6 p-2 sm:p-3 md:p-5 bg-blue-50 dark:bg-blue-900/10 rounded-lg border-2 border-blue-200 dark:border-blue-800 shadow-sm">
            <h3 className="text-sm md:text-base font-bold text-gray-900 dark:text-slate-100 mb-3">Stock &amp; Shipping Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">From Stock</label>
                <input
                  type="text"
                  value={formData.fromStock}
                  onChange={(e) => setFormData({...formData, fromStock: e.target.value})}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 md:px-4 py-2 text-sm md:text-base focus:border-blue-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="Location..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">To Stock</label>
                <input
                  type="text"
                  value={formData.toStock}
                  onChange={(e) => setFormData({...formData, toStock: e.target.value})}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 md:px-4 py-2 text-sm md:text-base focus:border-blue-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="Location..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Ship Via</label>
                <input
                  type="text"
                  value={formData.shipVia}
                  onChange={(e) => setFormData({...formData, shipVia: e.target.value})}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 md:px-4 py-2 text-sm md:text-base focus:border-blue-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  placeholder="Shipping method..."
                />
              </div>
            </div>
          </div>

          {/* Process Steps - Card-Based Layout */}
          <div className="mb-3 sm:mb-4 md:mb-6 p-2 sm:p-3 md:p-5 bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-slate-700 dark:to-slate-700 rounded-lg border-2 border-blue-200 dark:border-slate-600 shadow-sm max-w-full overflow-hidden" style={{ maxWidth: '100%' }}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
              <h3 className="text-lg md:text-xl font-bold text-gray-900 dark:text-slate-100">Process Steps (Routing)</h3>
              <button
                onClick={addNewStep}
                className="w-full sm:w-auto flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold transition-colors shadow-md"
              >
                <PlusIcon className="h-5 w-5" />
                <span>Add Step</span>
              </button>
            </div>

            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={formSteps.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 md:space-y-4 overflow-x-hidden w-full" style={{ maxWidth: '100%' }}>
              {formSteps.map((step, index) => (
                <SortableStepItem key={step.id} id={step.id}>
                  {({ dragHandleProps, style, ref }) => (
                <div
                  ref={(el) => {
                    ref(el);
                    stepRowRefs.current[step.id] = el;
                  }}
                  style={{ ...style, maxWidth: '100%', width: '100%' }}
                  className="bg-white dark:bg-slate-800 border-2 border-indigo-200 dark:border-slate-600 rounded-lg p-3 md:p-4 shadow-sm transition-colors duration-300 overflow-x-hidden max-w-full"
                >
                  {/* Step Header */}
                  <div className="mb-4 pb-3 border-b border-gray-200 dark:border-slate-700 overflow-hidden">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          {...dragHandleProps}
                          className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 touch-none"
                          title="Drag to reorder"
                        >
                          <Bars3Icon className="h-4 w-4" />
                        </button>
                        <span className="bg-blue-600 text-white font-bold px-2 py-1 rounded text-xs">
                          Step {step.sequence}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 bg-yellow-100 dark:bg-yellow-900/30 border-2 border-yellow-400 dark:border-yellow-700 rounded-lg px-3 py-1.5">
                        <label className="text-xs md:text-sm font-bold text-yellow-800 dark:text-yellow-300">SEQ #</label>
                        <input
                          type="number"
                          min="1"
                          value={step.sequence}
                          onChange={(e) => {
                            const newSeq = parseInt(e.target.value);
                            if (!isNaN(newSeq) && newSeq >= 1) {
                              updateStep(step.id, 'sequence', newSeq);
                            }
                          }}
                          className="w-28 min-w-[7rem] border-2 border-yellow-500 dark:border-yellow-700 rounded px-3 py-1.5 text-lg font-bold text-center bg-white dark:bg-slate-700 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <button
                        onClick={() => removeStep(step.id)}
                        className="flex items-center gap-1 px-2 py-1 text-white bg-red-600 hover:bg-red-700 rounded transition-colors text-xs font-semibold"
                        title="Remove step"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>

                  {/* Step Fields - RESPONSIVE COLUMNS */}
                  <div className="space-y-4 overflow-x-hidden w-full" style={{ maxWidth: '100%' }}>
                    {/* Row 1: Work Center - Full Width on Mobile */}
                    <div className="w-full overflow-x-hidden" style={{ maxWidth: '100%' }}>
                      <label className="block text-xs font-bold text-gray-700 mb-2">Work Center</label>
                      <div className="relative group w-full" style={{ maxWidth: '100%' }}>
                        <select
                          value={step.workCenter}
                          onChange={(e) => updateStep(step.id, 'workCenter', e.target.value)}
                          className="block w-full border-2 border-blue-400 dark:border-blue-600 rounded-lg px-2 font-medium hover:border-blue-500 focus:border-blue-600 focus:ring-2 focus:ring-blue-200 bg-white dark:bg-slate-700 dark:text-slate-100 cursor-pointer"
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
                            <option key={wc.name} value={wc.name} title={wc.description} style={{ fontSize: '13px' }}>
                              {wc.name}
                            </option>
                          ))}
                        </select>
                        {step.workCenter && (
                          <div className="hidden md:group-hover:block absolute left-0 top-full mt-1 z-50 p-4 bg-gray-900 text-white rounded-lg shadow-xl max-w-sm"
                            style={{ pointerEvents: 'none' }}
                          >
                            <div className="font-bold text-yellow-300 mb-1 text-base">{step.workCenter}</div>
                            <div className="text-sm leading-relaxed">{dynamicWorkCenters.find(wc => wc.name === step.workCenter)?.description || ''}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Quantity, Rejected, Accepted, Sign, Date - RESPONSIVE */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 md:gap-3 overflow-hidden">
                      <div className="col-span-1">
                        <label className="block text-xs font-bold text-gray-700 mb-2 text-center">Quantity</label>
                        <input
                          type="number"
                          value={step.quantity}
                          onChange={(e) => updateStep(step.id, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full border-2 border-gray-300 dark:border-slate-600 rounded px-2 py-2 text-sm text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-bold text-red-700 mb-2 text-center">Rejected</label>
                        <input
                          type="number"
                          value={step.rejected}
                          onChange={(e) => updateStep(step.id, 'rejected', parseInt(e.target.value) || 0)}
                          className="w-full border-2 border-red-300 dark:border-red-700 rounded px-2 py-2 text-sm text-center focus:border-red-500 focus:ring-1 focus:ring-red-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-bold text-green-700 mb-2 text-center">Accepted</label>
                        <input
                          type="number"
                          value={step.accepted}
                          onChange={(e) => updateStep(step.id, 'accepted', parseInt(e.target.value) || 0)}
                          className="w-full border-2 border-green-300 dark:border-green-700 rounded px-2 py-2 text-sm text-center focus:border-green-500 focus:ring-1 focus:ring-green-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs font-bold text-purple-700 mb-2 text-center">Sign</label>
                        <input
                          type="text"
                          value={step.assign}
                          onChange={(e) => updateStep(step.id, 'assign', e.target.value)}
                          className="w-full border-2 border-purple-300 dark:border-purple-700 rounded px-2 py-2 text-sm text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                          placeholder="Init"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="block text-xs font-bold text-gray-700 mb-2 text-center">Date</label>
                        <input
                          type="date"
                          value={step.date}
                          onChange={(e) => updateStep(step.id, 'date', e.target.value)}
                          className="w-full border-2 border-gray-300 dark:border-slate-600 rounded px-1.5 md:px-2 py-2 text-xs md:text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 overflow-hidden bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                          style={{ maxWidth: '100%' }}
                        />
                      </div>
                    </div>

                    {/* Row 2: Instructions - Full Width */}
                    <div>
                      <label className="block text-xs md:text-sm font-bold text-gray-700 dark:text-slate-300 mb-2">Instructions</label>
                      <textarea
                        value={step.instruction}
                        onChange={(e) => updateStep(step.id, 'instruction', e.target.value)}
                        className="w-full border-2 border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 min-h-[60px] md:min-h-[80px] resize-y bg-white dark:bg-slate-700"
                        placeholder="Enter detailed instructions for this step..."
                      />
                    </div>
                  </div>
                </div>
                  )}
                </SortableStepItem>
              ))}

              {formSteps.length === 0 && (
                <div className="text-center py-6 md:py-8 bg-gray-50 dark:bg-slate-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600">
                  <p className="text-sm md:text-base text-gray-600 dark:text-slate-400">No process steps yet. Click &quot;Add Step&quot; to create one.</p>
                </div>
              )}
            </div>
            </SortableContext>
            </DndContext>

            {/* Add Step Button at Bottom */}
            <div className="flex justify-center mt-4">
              <button
                onClick={addNewStep}
                className="w-full sm:w-auto flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold transition-colors shadow-md"
              >
                <PlusIcon className="h-5 w-5" />
                <span>Add Step</span>
              </button>
            </div>
          </div>

          {/* Comments Section - Prominent */}
          <div className="mb-3 sm:mb-4 md:mb-6 p-2 sm:p-3 md:p-5 bg-green-50 dark:bg-green-900/10 rounded-lg border-2 border-green-200 dark:border-green-800 shadow-sm">
            <label className="block text-sm md:text-base font-bold text-gray-900 dark:text-slate-100 mb-3">Comments &amp; Notes</label>
            <textarea
              value={formData.comments}
              onChange={(e) => setFormData({...formData, comments: e.target.value})}
              className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 md:px-4 py-2 md:py-3 text-sm md:text-base text-gray-900 dark:text-slate-100 focus:border-blue-500 min-h-[120px] md:min-h-[150px] resize-y bg-white dark:bg-slate-700"
              placeholder="Enter any additional comments, notes, quality issues, or special instructions..."
            />
          </div>
        </div>

        {/* Auto-Save Status Indicator */}
        {mode === 'create' && formData.jobNumber && (
          <div className="flex items-center justify-end mb-2 px-1">
            {autoSaveStatus === 'saving' && (
              <span className="flex items-center text-sm text-blue-600">
                <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Auto-saving draft...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="flex items-center text-sm text-green-600">
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
                Draft saved automatically
              </span>
            )}
            {autoSaveStatus === 'error' && (
              <span className="flex items-center text-sm text-red-600">
                <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Auto-save failed
              </span>
            )}
          </div>
        )}

        {/* Action Buttons - Bottom of Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6 mt-6 sm:mt-8 pt-4 sm:pt-6 border-t-2 border-gray-200 dark:border-slate-700 no-print">
          <button
            onClick={handleSaveDraft}
            disabled={isSubmitting}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>💾 Save as Draft</span>
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{isSubmitting ? 'Saving…' : (mode === 'create' ? 'Create Traveler' : 'Update Traveler')}</span>
          </button>
        </div>
      </div>

    </div>
  );
}
