export type TravelerType = 'PCB' | 'ASSY' | 'CABLE' | 'CABLE_ASSY' | 'MECHANICAL' | 'TEST';

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isApprover: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkCenter {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

export interface Part {
  id: string;
  partNumber: string;
  description: string;
  revision: string;
  workCenter: string;
  isActive: boolean;
}

export interface ProcessStep {
  id: string;
  stepNumber: number;
  operation: string;
  workCenter: string;
  instructions: string;
  subSteps: SubStep[];
  estimatedTime?: number;
  isRequired: boolean;
}

export interface SubStep {
  id: string;
  stepNumber: string;
  description: string;
  isCompleted: boolean;
  completedBy?: string;
  completedAt?: Date;
  notes?: string;
}

export interface ManualStep {
  id: string;
  description: string;
  addedBy: string;
  addedAt: Date;
}

export interface Traveler {
  id: string;
  jobNumber: string;
  workOrderNumber: string;
  travelerType: TravelerType;
  partNumber: string;
  partDescription: string;
  revision: string;
  availableRevisions: string[];
  quantity: number;
  customerCode: string;
  customerName: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  workCenter: string;
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
  processSteps: ProcessStep[];
  manualSteps: ManualStep[];
  laborHours: LaborEntry[];
  approvals: Approval[];
  auditLog: AuditEntry[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  notes?: string;
}

export interface LaborEntry {
  id: string;
  stepId: string;
  employeeId: string;
  employeeName: string;
  startTime: Date;
  endTime?: Date;
  hoursWorked: number;
  description: string;
  isCompleted: boolean;
}

export interface Approval {
  id: string;
  travelerId: string;
  requestedBy: string;
  requestedAt: Date;
  approverIds: string[];
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  requestType: 'EDIT' | 'COMPLETE' | 'CANCEL';
  requestDetails: string;
}

export interface AuditEntry {
  id: string;
  travelerId: string;
  userId: string;
  userName: string;
  action: 'CREATED' | 'UPDATED' | 'COMPLETED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
}

export interface WorkOrder {
  jobNumber: string;
  workOrderNumber: string;
  partNumber: string;
  partDescription: string;
  revision: string;
  quantity: number;
  customerCode: string;
  customerName: string;
  processSteps: Omit<ProcessStep, 'id'>[];
  workCenter: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormData {
  jobNumber: string;
  workOrderNumber: string;
  travelerType: TravelerType;
  partNumber: string;
  partDescription: string;
  revision: string;
  quantity: number;
  customerCode: string;
  customerName: string;
  workCenter: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  processSteps: ProcessStep[];
  manualSteps: ManualStep[];
  notes: string;
}