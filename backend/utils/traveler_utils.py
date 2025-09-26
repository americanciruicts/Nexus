from sqlalchemy.orm import Session
import models
from datetime import datetime

def generate_traveler_number(po_number: str, traveler_type: str, db: Session) -> str:
    """Generate unique traveler number"""
    count = db.query(models.Traveler).count() + 1
    timestamp = datetime.now().strftime("%m%d")
    return f"{po_number}-{traveler_type}-{timestamp}-{count:04d}"

def validate_traveler_data(traveler_data: dict) -> bool:
    """Validate traveler data before creation"""
    required_fields = ['po_number', 'traveler_type_id']

    for field in required_fields:
        if field not in traveler_data or not traveler_data[field]:
            return False

    return True

def calculate_estimated_completion(process_steps: list) -> datetime:
    """Calculate estimated completion date based on process steps"""
    total_hours = sum(step.get('estimated_hours', 0) for step in process_steps)

    # Assuming 8 working hours per day
    estimated_days = total_hours / 8

    from datetime import timedelta
    return datetime.now() + timedelta(days=estimated_days)

def get_next_revision_number(traveler_id: int, db: Session) -> int:
    """Get the next revision number for a traveler"""
    last_revision = db.query(models.RevisionHistory).filter(
        models.RevisionHistory.traveler_id == traveler_id
    ).order_by(models.RevisionHistory.revision_number.desc()).first()

    if last_revision:
        return last_revision.revision_number + 1
    else:
        return 1