export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  customer_name: string;
  job_number?: string;
  created_date: string;
  due_date?: string;
  status: string;
}

export interface TravelerType {
  id: number;
  type_name: string;
  description?: string;
  color_code: string;
}

export interface Traveler {
  id: number;
  traveler_number: string;
  job_number?: string;
  barcode?: string;
  status: string;
  revision: number;
  traveler_type: TravelerType;
  purchase_order: PurchaseOrder;
  created_at: string;
}

export interface BOMItem {
  id: number;
  part_number: string;
  description?: string;
  quantity: number;
  unit_price?: number;
  supplier?: string;
  notes?: string;
}

export interface ProcessStep {
  id: number;
  step_number: number;
  step_name: string;
  description?: string;
  estimated_hours?: number;
  required_role?: string;
  is_completed: boolean;
  completed_by?: number;
  completed_at?: string;
}

export interface LaborLog {
  id: number;
  traveler_id: number;
  process_step_id?: number;
  user_id: number;
  start_time: string;
  end_time?: string;
  hours_logged?: number;
  notes?: string;
}

export interface CoatingLog {
  id: number;
  traveler_id: number;
  coating_type?: string;
  sent_date?: string;
  received_date?: string;
  inspected_date?: string;
  tracking_number?: string;
  status: string;
  notes?: string;
}

export interface RevisionHistory {
  id: number;
  traveler_id: number;
  revision_number: number;
  change_description?: string;
  changed_by: number;
  change_date: string;
  change_reason?: string;
}

export interface DashboardStats {
  total_travelers: number;
  active_travelers: number;
  completed_today: number;
  total_users: number;
}

export interface CompletionReport {
  total_travelers: number;
  completed_travelers: number;
  in_progress_travelers: number;
  completion_rate: number;
  by_type: Array<{
    type: string;
    total: number;
    completed: number;
    completion_rate: number;
  }>;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
}