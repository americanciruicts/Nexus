from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime
from models import TravelerType, TravelerStatus, Priority, ApprovalStatus

# Customer code allows 200 characters, and spaces do not count toward that —
# so "AB CD" is 4 characters, not 5. The DB column is VARCHAR(500) so this
# check, not the column width, is what rejects an over-long code.
CUSTOMER_CODE_MAX_CHARS = 200


def _validate_customer_code(v):
    if v is None:
        return v
    if len(''.join(str(v).split())) > CUSTOMER_CODE_MAX_CHARS:
        raise ValueError(
            f'Customer code must be at most {CUSTOMER_CODE_MAX_CHARS} characters, not counting spaces'
        )
    return v

class SubStepBase(BaseModel):
    step_number: str
    description: str
    is_completed: bool = False
    notes: Optional[str] = None

class SubStepCreate(SubStepBase):
    pass

class SubStep(SubStepBase):
    id: int
    process_step_id: int
    completed_by: Optional[int] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ProcessStepBase(BaseModel):
    step_number: int
    operation: str
    work_center_code: str
    instructions: str
    estimated_time: Optional[int] = Field(None, ge=0)
    is_required: bool = True
    quantity: Optional[int] = Field(None, ge=0)
    accepted: Optional[int] = Field(None, ge=0)
    rejected: Optional[int] = Field(None, ge=0)
    sign: Optional[str] = Field(None, max_length=50)
    completed_date: Optional[str] = Field(None, max_length=20)
    completed_time: Optional[str] = Field(None, max_length=20)

class ProcessStepCreate(ProcessStepBase):
    sub_steps: List[SubStepCreate] = []

class ProcessStep(ProcessStepBase):
    id: int
    traveler_id: int
    is_completed: bool = False
    completed_by: Optional[int] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    sub_steps: List[SubStep] = []
    # Sign-off values rolled up from labor_entries (summed hours, latest labor
    # date, and one initial per operator who worked the step) . Derived at read
    # time in get_traveler, so they track newly-logged labor without a write.
    # Empty when no labor is logged against the step, in which case the manual
    # completed_time/completed_date/sign stand.
    labor_total_hours: Optional[float] = None
    labor_latest_date: Optional[str] = None
    labor_signers: List[str] = []

    class Config:
        from_attributes = True

class ManualStepBase(BaseModel):
    description: str

class ManualStepCreate(ManualStepBase):
    pass

class ManualStep(ManualStepBase):
    id: int
    traveler_id: int
    added_by: int
    added_at: datetime

    class Config:
        from_attributes = True

class RmaUnitTrackingBase(BaseModel):
    unit_number: int
    serial_number: Optional[str] = None
    customer_complaint: Optional[str] = None
    incoming_inspection_notes: Optional[str] = None
    disposition: Optional[str] = None
    troubleshooting_notes: Optional[str] = None
    repairing_notes: Optional[str] = None
    final_inspection_notes: Optional[str] = None
    # Additional fields for RMA_DIFF (per-unit original job info)
    customer_ncr: Optional[str] = None
    original_po_number: Optional[str] = None
    original_wo_number: Optional[str] = None
    customer_revision_sent: Optional[str] = None
    customer_revision_received: Optional[str] = None
    original_built_quantity: Optional[int] = None
    units_shipped: Optional[int] = None
    # JSON-encoded dict of values for user-added custom columns
    custom_values: Optional[str] = None

class RmaUnitTrackingCreate(RmaUnitTrackingBase):
    pass

class RmaUnitTracking(RmaUnitTrackingBase):
    id: int
    traveler_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class TravelerBase(BaseModel):
    job_number: str = Field(..., max_length=50)
    work_order_number: Optional[str] = Field(None, max_length=50)
    po_number: Optional[str] = Field(None, max_length=255)
    traveler_type: TravelerType
    part_number: str = Field(..., max_length=50)
    part_description: str = Field(..., max_length=200)
    revision: str = Field(..., max_length=20)
    customer_revision: Optional[str] = Field(None, max_length=50)
    quantity: int = Field(..., gt=0)
    customer_code: Optional[str] = Field(None, max_length=500)
    customer_name: Optional[str] = Field(None, max_length=100)
    priority: Priority = Priority.NORMAL
    work_center: str = Field(..., max_length=20)
    is_active: bool = True
    notes: Optional[str] = None
    specs: Optional[str] = None
    specs_date: Optional[str] = Field(None, max_length=20)
    from_stock: Optional[str] = Field(None, max_length=100)
    to_stock: Optional[str] = Field(None, max_length=100)
    ship_via: Optional[str] = Field(None, max_length=100)
    comments: Optional[str] = None
    start_date: Optional[str] = Field(None, max_length=20)
    due_date: Optional[str] = Field(None, max_length=20)
    ship_date: Optional[str] = Field(None, max_length=20)
    include_labor_hours: bool = False
    # RMA-specific fields
    rma_number: Optional[str] = Field(None, max_length=50)
    customer_contact: Optional[str] = Field(None, max_length=100)
    original_wo_number: Optional[str] = Field(None, max_length=50)
    original_po_number: Optional[str] = Field(None, max_length=255)
    return_po_number: Optional[str] = Field(None, max_length=255)
    rma_po_number: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    customer_ncr: Optional[str] = Field(None, max_length=100)
    original_built_quantity: Optional[int] = None
    units_shipped: Optional[int] = None
    quantity_rma_issued: Optional[int] = None
    units_received: Optional[int] = None
    customer_revision_sent: Optional[str] = Field(None, max_length=50)
    customer_revision_received: Optional[str] = Field(None, max_length=50)
    rma_notes: Optional[str] = None
    wo_type_label: Optional[str] = Field(None, max_length=50)
    assy_type: Optional[str] = Field(None, max_length=50)
    include_sn_table: Optional[bool] = None
    rma_table_columns: Optional[str] = None
    rma_orig_table_columns: Optional[str] = None

    _check_customer_code = field_validator('customer_code')(_validate_customer_code)

class TravelerCreate(TravelerBase):
    status: Optional[TravelerStatus] = None
    process_steps: List[ProcessStepCreate] = []
    manual_steps: List[ManualStepCreate] = []
    rma_units: List[RmaUnitTrackingCreate] = []

class TravelerUpdate(BaseModel):
    job_number: Optional[str] = Field(None, max_length=50)
    work_order_number: Optional[str] = Field(None, max_length=50)
    po_number: Optional[str] = Field(None, max_length=255)
    traveler_type: Optional[TravelerType] = None
    part_number: Optional[str] = Field(None, max_length=50)
    part_description: Optional[str] = Field(None, max_length=200)
    revision: Optional[str] = Field(None, max_length=20)
    customer_revision: Optional[str] = Field(None, max_length=50)
    quantity: Optional[int] = Field(None, gt=0)
    customer_code: Optional[str] = Field(None, max_length=500)
    customer_name: Optional[str] = Field(None, max_length=100)
    priority: Optional[Priority] = None
    work_center: Optional[str] = Field(None, max_length=20)
    status: Optional[TravelerStatus] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    specs: Optional[str] = None
    specs_date: Optional[str] = Field(None, max_length=20)
    from_stock: Optional[str] = Field(None, max_length=100)
    to_stock: Optional[str] = Field(None, max_length=100)
    ship_via: Optional[str] = Field(None, max_length=100)
    comments: Optional[str] = None
    start_date: Optional[str] = Field(None, max_length=20)
    due_date: Optional[str] = Field(None, max_length=20)
    ship_date: Optional[str] = Field(None, max_length=20)
    include_labor_hours: Optional[bool] = None
    # RMA-specific fields
    rma_number: Optional[str] = Field(None, max_length=50)
    customer_contact: Optional[str] = Field(None, max_length=100)
    original_wo_number: Optional[str] = Field(None, max_length=50)
    original_po_number: Optional[str] = Field(None, max_length=255)
    return_po_number: Optional[str] = Field(None, max_length=255)
    rma_po_number: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    customer_ncr: Optional[str] = Field(None, max_length=100)
    original_built_quantity: Optional[int] = None
    units_shipped: Optional[int] = None
    quantity_rma_issued: Optional[int] = None
    units_received: Optional[int] = None
    customer_revision_sent: Optional[str] = Field(None, max_length=50)
    customer_revision_received: Optional[str] = Field(None, max_length=50)
    rma_notes: Optional[str] = None
    wo_type_label: Optional[str] = Field(None, max_length=50)
    assy_type: Optional[str] = Field(None, max_length=50)
    include_sn_table: Optional[bool] = None
    rma_table_columns: Optional[str] = None
    rma_orig_table_columns: Optional[str] = None

    _check_customer_code = field_validator('customer_code')(_validate_customer_code)

class TravelerGroupMember(BaseModel):
    id: int
    job_number: str
    traveler_type: str
    group_sequence: int
    group_label: Optional[str] = None
    quantity: int
    status: str
    work_order_number: Optional[str] = None

class TravelerGroupInfo(BaseModel):
    group_id: int
    group_name: Optional[str] = None
    current_sequence: int
    total_count: int
    members: List[TravelerGroupMember]

class LinkTravelersRequest(BaseModel):
    traveler_ids: List[int]
    labels: List[str]
    group_name: Optional[str] = None

class Traveler(TravelerBase):
    id: int
    status: TravelerStatus
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    process_steps: List[ProcessStep] = []
    manual_steps: List[ManualStep] = []
    rma_units: List[RmaUnitTracking] = []
    group_id: Optional[int] = None
    group_sequence: Optional[int] = None
    group_label: Optional[str] = None

    class Config:
        from_attributes = True

class TravelerList(BaseModel):
    id: int
    job_number: str
    work_order_number: Optional[str]
    po_number: Optional[str] = None
    traveler_type: TravelerType
    part_number: str
    part_description: str
    revision: str  # Traveler Revision
    customer_revision: Optional[str] = None  # Customer Revision
    quantity: int
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    priority: Priority
    status: TravelerStatus
    work_center: str
    is_active: bool = True
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    ship_date: Optional[str] = None
    created_at: datetime
    created_by: int
    total_steps: int = 0
    completed_steps: int = 0
    percent_complete: float = 0.0
    department_progress: Optional[list] = []
    labor_progress: Optional[dict] = None
    include_labor_hours: Optional[bool] = False
    group_id: Optional[int] = None
    group_sequence: Optional[int] = None
    group_label: Optional[str] = None

    class Config:
        from_attributes = True

class ApprovalBase(BaseModel):
    request_type: str = Field(..., pattern="^(EDIT|COMPLETE|CANCEL)$")
    request_details: str

class ApprovalCreate(ApprovalBase):
    traveler_id: int

class Approval(ApprovalBase):
    id: int
    traveler_id: int
    requested_by: int
    requested_at: datetime
    status: ApprovalStatus
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejected_by: Optional[int] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None

    class Config:
        from_attributes = True