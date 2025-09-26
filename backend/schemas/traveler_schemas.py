from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date

class TravelerBase(BaseModel):
    po_number: str
    traveler_type_id: int
    job_number: Optional[str] = None

class TravelerCreate(TravelerBase):
    pass

class TravelerUpdate(BaseModel):
    status: Optional[str] = None
    revision: Optional[int] = None

class TravelerTypeSchema(BaseModel):
    id: int
    type_name: str
    description: Optional[str] = None
    color_code: str

    class Config:
        from_attributes = True

class PurchaseOrderSchema(BaseModel):
    id: int
    po_number: str
    customer_name: str
    job_number: Optional[str] = None

    class Config:
        from_attributes = True

class TravelerSchema(BaseModel):
    id: int
    traveler_number: str
    job_number: Optional[str] = None
    barcode: Optional[str] = None
    status: str
    revision: int
    traveler_type: TravelerTypeSchema
    purchase_order: PurchaseOrderSchema
    created_at: datetime

    class Config:
        from_attributes = True

class BOMItemCreate(BaseModel):
    part_number: str
    description: Optional[str] = None
    quantity: int
    unit_price: Optional[float] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None

class BOMItemSchema(BaseModel):
    id: int
    part_number: str
    description: Optional[str] = None
    quantity: int
    unit_price: Optional[float] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class ProcessStepCreate(BaseModel):
    step_number: int
    step_name: str
    description: Optional[str] = None
    estimated_hours: Optional[float] = None
    required_role: Optional[str] = None

class ProcessStepSchema(BaseModel):
    id: int
    step_number: int
    step_name: str
    description: Optional[str] = None
    estimated_hours: Optional[float] = None
    required_role: Optional[str] = None
    is_completed: bool
    completed_by: Optional[int] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True