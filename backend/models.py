from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, Date, Decimal, ForeignKey
from sqlalchemy.relationship import relationship
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="operator")
    first_name = Column(String(50))
    last_name = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    po_number = Column(String(50), unique=True, nullable=False)
    customer_name = Column(String(100), nullable=False)
    job_number = Column(String(50))
    created_date = Column(Date, nullable=False)
    due_date = Column(Date)
    status = Column(String(20), default="active")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    travelers = relationship("Traveler", back_populates="purchase_order")

class TravelerType(Base):
    __tablename__ = "traveler_types"

    id = Column(Integer, primary_key=True, index=True)
    type_name = Column(String(20), unique=True, nullable=False)
    description = Column(Text)
    color_code = Column(String(7))

    travelers = relationship("Traveler", back_populates="traveler_type")

class Traveler(Base):
    __tablename__ = "travelers"

    id = Column(Integer, primary_key=True, index=True)
    traveler_number = Column(String(50), unique=True, nullable=False)
    po_id = Column(Integer, ForeignKey("purchase_orders.id"))
    traveler_type_id = Column(Integer, ForeignKey("traveler_types.id"))
    job_number = Column(String(50))
    barcode = Column(String(100), unique=True)
    status = Column(String(20), default="created")
    revision = Column(Integer, default=1)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    purchase_order = relationship("PurchaseOrder", back_populates="travelers")
    traveler_type = relationship("TravelerType", back_populates="travelers")
    bom_items = relationship("BOMItem", back_populates="traveler")
    process_sequences = relationship("ProcessSequence", back_populates="traveler")
    labor_logs = relationship("LaborLog", back_populates="traveler")
    coating_logs = relationship("CoatingLog", back_populates="traveler")
    revision_history = relationship("RevisionHistory", back_populates="traveler")

class BOMItem(Base):
    __tablename__ = "bom_items"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"))
    part_number = Column(String(100), nullable=False)
    description = Column(Text)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Decimal(10, 2))
    supplier = Column(String(100))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    traveler = relationship("Traveler", back_populates="bom_items")

class ProcessSequence(Base):
    __tablename__ = "process_sequences"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"))
    step_number = Column(Integer, nullable=False)
    step_name = Column(String(100), nullable=False)
    description = Column(Text)
    estimated_hours = Column(Decimal(5, 2))
    required_role = Column(String(50))
    is_completed = Column(Boolean, default=False)
    completed_by = Column(Integer, ForeignKey("users.id"))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    traveler = relationship("Traveler", back_populates="process_sequences")

class LaborLog(Base):
    __tablename__ = "labor_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"))
    process_step_id = Column(Integer, ForeignKey("process_sequences.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True))
    hours_logged = Column(Decimal(5, 2))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    traveler = relationship("Traveler", back_populates="labor_logs")

class CoatingLog(Base):
    __tablename__ = "coating_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"))
    coating_type = Column(String(50))
    sent_date = Column(Date)
    received_date = Column(Date)
    inspected_date = Column(Date)
    tracking_number = Column(String(100))
    status = Column(String(20), default="sent")
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    traveler = relationship("Traveler", back_populates="coating_logs")

class RevisionHistory(Base):
    __tablename__ = "revision_history"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"))
    revision_number = Column(Integer, nullable=False)
    change_description = Column(Text)
    changed_by = Column(Integer, ForeignKey("users.id"))
    change_date = Column(DateTime(timezone=True), server_default=func.now())
    change_reason = Column(String(100))

    traveler = relationship("Traveler", back_populates="revision_history")