from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models import User, Traveler
from routers.auth import get_current_user
from services.barcode_service import BarcodeService

router = APIRouter()

class BarcodeData(BaseModel):
    barcode: str

class QRCodeData(BaseModel):
    qr_code: str

class TraverlerBarcodeResponse(BaseModel):
    traveler_id: int
    barcode_data: str
    barcode_image: str  # base64 encoded
    qr_code_image: str  # base64 encoded
    unique_id: str

@router.get("/traveler/{traveler_id}")
async def get_traveler_barcode(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get barcode and QR code for a specific traveler"""

    # Verify traveler exists
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Generate barcode
    barcode_image = BarcodeService.generate_traveler_barcode(
        traveler.id, traveler.job_number
    )

    # Generate QR code
    qr_code_image = BarcodeService.generate_qr_code(
        traveler.id, traveler.job_number, traveler.part_number
    )

    # Generate unique ID
    unique_id = BarcodeService.generate_unique_traveler_id()

    return {
        "traveler_id": traveler.id,
        "barcode_data": f"NEX-{traveler.id:06d}-{traveler.job_number}",
        "barcode_image": barcode_image,
        "qr_code_image": qr_code_image,
        "unique_id": unique_id,
        "job_number": traveler.job_number,
        "part_number": traveler.part_number,
        "part_description": traveler.part_description
    }

@router.post("/scan/barcode")
async def scan_barcode(
    barcode_data: BarcodeData,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Scan and parse barcode to get traveler information"""

    # Parse barcode
    parsed_data = BarcodeService.parse_barcode(barcode_data.barcode)

    if "error" in parsed_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=parsed_data["error"]
        )

    # Find traveler by ID
    traveler = db.query(Traveler).filter(
        Traveler.id == parsed_data["traveler_id"]
    ).first()

    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found for this barcode"
        )

    # Verify job number matches
    if traveler.job_number != parsed_data["job_number"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Barcode job number does not match traveler"
        )

    return {
        "traveler_id": traveler.id,
        "job_number": traveler.job_number,
        "work_order_number": traveler.work_order_number,
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "quantity": traveler.quantity,
        "status": traveler.status.value,
        "work_center": traveler.work_center,
        "priority": traveler.priority.value,
        "created_at": traveler.created_at,
        "scan_successful": True
    }

@router.post("/scan/qr")
async def scan_qr_code(
    qr_data: QRCodeData,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Scan and parse QR code to get traveler information"""

    # Parse QR code
    parsed_data = BarcodeService.parse_qr_code(qr_data.qr_code)

    if "error" in parsed_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=parsed_data["error"]
        )

    # Find traveler by ID
    traveler = db.query(Traveler).filter(
        Traveler.id == parsed_data["traveler_id"]
    ).first()

    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found for this QR code"
        )

    # Verify data matches
    if (traveler.job_number != parsed_data["job_number"] or
        traveler.part_number != parsed_data["part_number"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR code data does not match traveler"
        )

    return {
        "traveler_id": traveler.id,
        "job_number": traveler.job_number,
        "work_order_number": traveler.work_order_number,
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "quantity": traveler.quantity,
        "status": traveler.status.value,
        "work_center": traveler.work_center,
        "priority": traveler.priority.value,
        "created_at": traveler.created_at,
        "scan_successful": True,
        "system": parsed_data["system"],
        "company": parsed_data["company"]
    }

@router.get("/traveler/{traveler_id}/label")
async def generate_traveler_label(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Generate printable label for traveler with barcode and QR code"""

    # Verify traveler exists
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Prepare traveler data for label
    traveler_data = {
        "traveler_id": traveler.id,
        "job_number": traveler.job_number,
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "quantity": traveler.quantity,
        "created_at": traveler.created_at.strftime("%Y-%m-%d %H:%M:%S")
    }

    # Generate label
    label_pdf = BarcodeService.generate_traveler_label(traveler_data)

    if not label_pdf:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate traveler label"
        )

    return {
        "traveler_id": traveler.id,
        "label_pdf": label_pdf,
        "filename": f"traveler_label_{traveler.job_number}_{traveler.id}.pdf"
    }

@router.get("/search")
async def search_by_barcode_or_qr(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Universal search by barcode or QR code data"""

    # Try parsing as barcode first
    barcode_result = BarcodeService.parse_barcode(code)
    if barcode_result.get("valid"):
        traveler = db.query(Traveler).filter(
            Traveler.id == barcode_result["traveler_id"]
        ).first()

        if traveler and traveler.job_number == barcode_result["job_number"]:
            return {
                "type": "barcode",
                "traveler": {
                    "id": traveler.id,
                    "job_number": traveler.job_number,
                    "part_number": traveler.part_number,
                    "part_description": traveler.part_description,
                    "status": traveler.status.value
                }
            }

    # Try parsing as QR code
    qr_result = BarcodeService.parse_qr_code(code)
    if qr_result.get("valid"):
        traveler = db.query(Traveler).filter(
            Traveler.id == qr_result["traveler_id"]
        ).first()

        if traveler and traveler.job_number == qr_result["job_number"]:
            return {
                "type": "qr_code",
                "traveler": {
                    "id": traveler.id,
                    "job_number": traveler.job_number,
                    "part_number": traveler.part_number,
                    "part_description": traveler.part_description,
                    "status": traveler.status.value
                }
            }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No traveler found for the provided code"
    )