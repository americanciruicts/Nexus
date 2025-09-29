from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey, Float, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum

class UserRole(enum.Enum):
    ADMIN = "ADMIN"
    SUPERVISOR = "SUPERVISOR"
    OPERATOR = "OPERATOR"
    VIEWER = "VIEWER"

class TravelerType(enum.Enum):
    PCB = "PCB"
    ASSY = "ASSY"
    CABLE = "CABLE"
    CABLE_ASSY = "CABLE_ASSY"
    MECHANICAL = "MECHANICAL"
    TEST = "TEST"

class TravelerStatus(enum.Enum):
    CREATED = "CREATED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ON_HOLD = "ON_HOLD"
    CANCELLED = "CANCELLED"

class Priority(enum.Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    URGENT = "URGENT"

class ApprovalStatus(enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.OPERATOR)
    is_approver = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    created_travelers = relationship("Traveler", back_populates="creator")
    labor_entries = relationship("LaborEntry", back_populates="employee")
    audit_logs = relationship("AuditLog", back_populates="user")

class WorkCenter(Base):
    __tablename__ = "work_centers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    description = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    process_steps = relationship("ProcessStep", back_populates="work_center")

class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True, index=True)
    part_number = Column(String(50), nullable=False, index=True)
    description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    work_center_code = Column(String(20), nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    travelers = relationship("Traveler", back_populates="part")

class Traveler(Base):
    __tablename__ = "travelers"

    id = Column(Integer, primary_key=True, index=True)
    job_number = Column(String(50), nullable=False, index=True)
    work_order_number = Column(String(50), index=True)
    traveler_type = Column(Enum(TravelerType), nullable=False)
    part_number = Column(String(50), nullable=False)
    part_description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    priority = Column(Enum(Priority), default=Priority.NORMAL)
    work_center = Column(String(20), nullable=False)
    status = Column(Enum(TravelerStatus), default=TravelerStatus.CREATED)
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True))

    # Foreign keys
    part_id = Column(Integer, ForeignKey("parts.id"))

    # Relationships
    creator = relationship("User", back_populates="created_travelers")
    part = relationship("Part", back_populates="travelers")
    process_steps = relationship("ProcessStep", back_populates="traveler")
    manual_steps = relationship("ManualStep", back_populates="traveler")
    labor_entries = relationship("LaborEntry", back_populates="traveler")
    approvals = relationship("Approval", back_populates="traveler")
    audit_logs = relationship("AuditLog", back_populates="traveler")

class ProcessStep(Base):
    __tablename__ = "process_steps"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    step_number = Column(Integer, nullable=False)
    operation = Column(String(100), nullable=False)
    work_center_code = Column(String(20), ForeignKey("work_centers.code"), nullable=False)
    instructions = Column(Text, nullable=False)
    estimated_time = Column(Integer)  # in minutes
    is_required = Column(Boolean, default=True)
    is_completed = Column(Boolean, default=False)
    completed_by = Column(Integer, ForeignKey("users.id"))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="process_steps")
    work_center = relationship("WorkCenter", back_populates="process_steps")
    sub_steps = relationship("SubStep", back_populates="process_step")

class SubStep(Base):
    __tablename__ = "sub_steps"

    id = Column(Integer, primary_key=True, index=True)
    process_step_id = Column(Integer, ForeignKey("process_steps.id"), nullable=False)
    step_number = Column(String(10), nullable=False)  # e.g., "1.1", "1.2"
    description = Column(Text, nullable=False)
    is_completed = Column(Boolean, default=False)
    completed_by = Column(Integer, ForeignKey("users.id"))
    completed_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    process_step = relationship("ProcessStep", back_populates="sub_steps")

class ManualStep(Base):
    __tablename__ = "manual_steps"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    description = Column(Text, nullable=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="manual_steps")

class LaborEntry(Base):
    __tablename__ = "labor_entries"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    step_id = Column(Integer, ForeignKey("process_steps.id"))
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True))
    hours_worked = Column(Float, default=0.0)
    description = Column(Text)
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="labor_entries")
    employee = relationship("User", back_populates="labor_entries")

class Approval(Base):
    __tablename__ = "approvals"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING)
    approved_by = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    rejected_by = Column(Integer, ForeignKey("users.id"))
    rejected_at = Column(DateTime(timezone=True))
    rejection_reason = Column(Text)
    request_type = Column(String(20), nullable=False)  # 'EDIT', 'COMPLETE', 'CANCEL'
    request_details = Column(Text, nullable=False)

    # Relationships
    traveler = relationship("Traveler", back_populates="approvals")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(20), nullable=False)  # 'CREATED', 'UPDATED', 'COMPLETED', etc.
    field_changed = Column(String(50))
    old_value = Column(Text)
    new_value = Column(Text)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    ip_address = Column(String(45))
    user_agent = Column(String(500))

    # Relationships
    traveler = relationship("Traveler", back_populates="audit_logs")
    user = relationship("User", back_populates="audit_logs")

class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    job_number = Column(String(50), nullable=False, index=True)
    work_order_number = Column(String(50), nullable=False, index=True)
    part_number = Column(String(50), nullable=False)
    part_description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    work_center = Column(String(20), nullable=False)
    priority = Column(Enum(Priority), default=Priority.NORMAL)
    process_template = Column(Text)  # JSON string of process steps
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())