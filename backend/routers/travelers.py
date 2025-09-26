from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime
import models
from database import get_db
from routers.auth import get_current_user
import barcode
from barcode.writer import ImageWriter
import io
import base64

router = APIRouter()

class TravelerCreate(BaseModel):
    po_number: str
    traveler_type_id: int
    job_number: Optional[str] = None

class TravelerResponse(BaseModel):
    id: int
    traveler_number: str
    job_number: Optional[str]
    barcode: Optional[str]
    status: str
    revision: int
    traveler_type: dict
    purchase_order: dict
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

class ProcessStepCreate(BaseModel):
    step_number: int
    step_name: str
    description: Optional[str] = None
    estimated_hours: Optional[float] = None
    required_role: Optional[str] = None

def generate_barcode(traveler_number: str) -> str:
    """Generate a barcode for the traveler"""
    try:
        code128 = barcode.get_barcode_class('code128')
        barcode_instance = code128(traveler_number, writer=ImageWriter())

        buffer = io.BytesIO()
        barcode_instance.write(buffer)
        buffer.seek(0)

        barcode_base64 = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/png;base64,{barcode_base64}"
    except Exception:
        return ""

def generate_traveler_number(po_number: str, traveler_type: str, db: Session) -> str:
    """Generate unique traveler number"""
    count = db.query(models.Traveler).count() + 1
    return f"{po_number}-{traveler_type}-{count:04d}"

@router.post("/", response_model=TravelerResponse)
async def create_traveler(
    traveler_data: TravelerCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Get PO
    po = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.po_number == traveler_data.po_number
    ).first()

    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")

    # Get traveler type
    traveler_type = db.query(models.TravelerType).filter(
        models.TravelerType.id == traveler_data.traveler_type_id
    ).first()

    if not traveler_type:
        raise HTTPException(status_code=404, detail="Traveler type not found")

    # Generate traveler number and barcode
    traveler_number = generate_traveler_number(po.po_number, traveler_type.type_name, db)
    barcode_data = generate_barcode(traveler_number)

    # Create traveler
    traveler = models.Traveler(
        traveler_number=traveler_number,
        po_id=po.id,
        traveler_type_id=traveler_data.traveler_type_id,
        job_number=traveler_data.job_number,
        barcode=barcode_data,
        created_by=current_user.id
    )

    db.add(traveler)
    db.commit()
    db.refresh(traveler)

    return {
        "id": traveler.id,
        "traveler_number": traveler.traveler_number,
        "job_number": traveler.job_number,
        "barcode": traveler.barcode,
        "status": traveler.status,
        "revision": traveler.revision,
        "traveler_type": {
            "id": traveler_type.id,
            "type_name": traveler_type.type_name,
            "color_code": traveler_type.color_code
        },
        "purchase_order": {
            "id": po.id,
            "po_number": po.po_number,
            "customer_name": po.customer_name
        },
        "created_at": traveler.created_at
    }

@router.get("/", response_model=List[TravelerResponse])
async def get_travelers(
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    travelers = db.query(models.Traveler).offset(skip).limit(limit).all()

    result = []
    for traveler in travelers:
        result.append({
            "id": traveler.id,
            "traveler_number": traveler.traveler_number,
            "job_number": traveler.job_number,
            "barcode": traveler.barcode,
            "status": traveler.status,
            "revision": traveler.revision,
            "traveler_type": {
                "id": traveler.traveler_type.id,
                "type_name": traveler.traveler_type.type_name,
                "color_code": traveler.traveler_type.color_code
            },
            "purchase_order": {
                "id": traveler.purchase_order.id,
                "po_number": traveler.purchase_order.po_number,
                "customer_name": traveler.purchase_order.customer_name
            },
            "created_at": traveler.created_at
        })

    return result

@router.get("/{traveler_id}", response_model=TravelerResponse)
async def get_traveler(
    traveler_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    traveler = db.query(models.Traveler).filter(models.Traveler.id == traveler_id).first()

    if not traveler:
        raise HTTPException(status_code=404, detail="Traveler not found")

    return {
        "id": traveler.id,
        "traveler_number": traveler.traveler_number,
        "job_number": traveler.job_number,
        "barcode": traveler.barcode,
        "status": traveler.status,
        "revision": traveler.revision,
        "traveler_type": {
            "id": traveler.traveler_type.id,
            "type_name": traveler.traveler_type.type_name,
            "color_code": traveler.traveler_type.color_code
        },
        "purchase_order": {
            "id": traveler.purchase_order.id,
            "po_number": traveler.purchase_order.po_number,
            "customer_name": traveler.purchase_order.customer_name
        },
        "created_at": traveler.created_at
    }

@router.post("/{traveler_id}/bom")
async def add_bom_item(
    traveler_id: int,
    bom_item: BOMItemCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    traveler = db.query(models.Traveler).filter(models.Traveler.id == traveler_id).first()

    if not traveler:
        raise HTTPException(status_code=404, detail="Traveler not found")

    bom = models.BOMItem(
        traveler_id=traveler_id,
        **bom_item.dict()
    )

    db.add(bom)
    db.commit()
    db.refresh(bom)

    return {"message": "BOM item added successfully", "id": bom.id}

@router.post("/{traveler_id}/process-step")
async def add_process_step(
    traveler_id: int,
    process_step: ProcessStepCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    traveler = db.query(models.Traveler).filter(models.Traveler.id == traveler_id).first()

    if not traveler:
        raise HTTPException(status_code=404, detail="Traveler not found")

    step = models.ProcessSequence(
        traveler_id=traveler_id,
        **process_step.dict()
    )

    db.add(step)
    db.commit()
    db.refresh(step)

    return {"message": "Process step added successfully", "id": step.id}

@router.get("/types/")
async def get_traveler_types(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    types = db.query(models.TravelerType).all()
    return [
        {
            "id": t.id,
            "type_name": t.type_name,
            "description": t.description,
            "color_code": t.color_code
        }
        for t in types
    ]