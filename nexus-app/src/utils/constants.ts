export const TRAVELER_STATUSES = {
  CREATED: 'created',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
} as const;

export const USER_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  OPERATOR: 'operator',
  QUALITY: 'quality',
  PURCHASING: 'purchasing',
  ASSEMBLY: 'assembly',
  ENGINEER: 'engineer'
} as const;

export const TRAVELER_TYPES = {
  PCB: 'PCB',
  PARTS: 'Parts',
  ASSEMBLY: 'Assembly',
  CABLE: 'Cable'
} as const;

export const COATING_STATUSES = {
  SENT: 'sent',
  RECEIVED: 'received',
  INSPECTED: 'inspected',
  COMPLETED: 'completed'
} as const;

export const DEFAULT_COLORS = {
  PCB: '#3B82F6',
  PARTS: '#10B981',
  ASSEMBLY: '#F59E0B',
  CABLE: '#8B5CF6'
} as const;