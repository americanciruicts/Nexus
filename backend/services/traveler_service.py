from sqlalchemy.orm import Session
from typing import List, Optional
import models
from schemas.traveler_schemas import TravelerCreate, BOMItemCreate, ProcessStepCreate
from utils.barcode_generator import generate_barcode
from utils.traveler_utils import generate_traveler_number

class TravelerService:
    def __init__(self, db: Session):
        self.db = db

    def get_travelers(self, skip: int = 0, limit: int = 100) -> List[models.Traveler]:
        return self.db.query(models.Traveler).offset(skip).limit(limit).all()

    def get_traveler_by_id(self, traveler_id: int) -> Optional[models.Traveler]:
        return self.db.query(models.Traveler).filter(models.Traveler.id == traveler_id).first()

    def create_traveler(self, traveler_data: TravelerCreate, user_id: int) -> models.Traveler:
        # Get PO
        po = self.db.query(models.PurchaseOrder).filter(
            models.PurchaseOrder.po_number == traveler_data.po_number
        ).first()

        if not po:
            raise ValueError("Purchase Order not found")

        # Get traveler type
        traveler_type = self.db.query(models.TravelerType).filter(
            models.TravelerType.id == traveler_data.traveler_type_id
        ).first()

        if not traveler_type:
            raise ValueError("Traveler type not found")

        # Generate traveler number and barcode
        traveler_number = generate_traveler_number(po.po_number, traveler_type.type_name, self.db)
        barcode_data = generate_barcode(traveler_number)

        # Create traveler
        traveler = models.Traveler(
            traveler_number=traveler_number,
            po_id=po.id,
            traveler_type_id=traveler_data.traveler_type_id,
            job_number=traveler_data.job_number,
            barcode=barcode_data,
            created_by=user_id
        )

        self.db.add(traveler)
        self.db.commit()
        self.db.refresh(traveler)

        return traveler

    def add_bom_item(self, traveler_id: int, bom_data: BOMItemCreate) -> models.BOMItem:
        bom_item = models.BOMItem(
            traveler_id=traveler_id,
            **bom_data.dict()
        )

        self.db.add(bom_item)
        self.db.commit()
        self.db.refresh(bom_item)

        return bom_item

    def add_process_step(self, traveler_id: int, step_data: ProcessStepCreate) -> models.ProcessSequence:
        process_step = models.ProcessSequence(
            traveler_id=traveler_id,
            **step_data.dict()
        )

        self.db.add(process_step)
        self.db.commit()
        self.db.refresh(process_step)

        return process_step

    def update_traveler_status(self, traveler_id: int, status: str, user_id: int) -> models.Traveler:
        traveler = self.get_traveler_by_id(traveler_id)
        if not traveler:
            raise ValueError("Traveler not found")

        traveler.status = status

        # Create revision history entry
        revision_entry = models.RevisionHistory(
            traveler_id=traveler_id,
            revision_number=traveler.revision + 1,
            change_description=f"Status updated to {status}",
            changed_by=user_id,
            change_reason="Status update"
        )

        traveler.revision += 1

        self.db.add(revision_entry)
        self.db.commit()
        self.db.refresh(traveler)

        return traveler

    def get_traveler_types(self) -> List[models.TravelerType]:
        return self.db.query(models.TravelerType).all()