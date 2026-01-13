import uuid
from datetime import datetime, date
from sqlalchemy import Column, String, Float, Date, DateTime, ForeignKey, Text, Enum as SQLEnum, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
import enum

from app.db.session import Base


class BillingRecord(Base):
    __tablename__ = "billing_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="CASCADE"), nullable=False, index=True)

    # Billing period
    billing_date = Column(Date, nullable=False, index=True)

    # Cost breakdown
    total_cost = Column(Float, nullable=False)
    compute_cost = Column(Float, default=0.0)
    storage_cost = Column(Float, default=0.0)
    backup_cost = Column(Float, default=0.0)
    data_transfer_cost = Column(Float, default=0.0)
    other_cost = Column(Float, default=0.0)

    # Usage metrics
    compute_hours = Column(Float)
    storage_gb = Column(Float)
    data_transfer_gb = Column(Float)

    # Metadata
    currency = Column(String(3), default="USD")
    billing_source = Column(String(50))  # aws, gcp, azure

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    database = relationship("Database", back_populates="billing_records")

    def __repr__(self):
        return f"<BillingRecord ${self.total_cost} on {self.billing_date}>"


class CostAnomalyType(str, enum.Enum):
    SPIKE = "spike"
    SUSTAINED_INCREASE = "sustained_increase"
    UNEXPECTED_CHARGE = "unexpected_charge"


class CostAnomaly(Base):
    __tablename__ = "cost_anomalies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="SET NULL"), nullable=True, index=True)

    # Anomaly details
    anomaly_type = Column(SQLEnum(CostAnomalyType), nullable=False)
    amount = Column(Float, nullable=False)
    baseline_amount = Column(Float, nullable=False)
    deviation_percent = Column(Float, nullable=False)

    # AI-generated content
    explanation = Column(Text)
    possible_causes = Column(ARRAY(String))

    # Time context
    detected_at = Column(DateTime, default=datetime.utcnow)
    period_start = Column(Date)
    period_end = Column(Date)

    # Status
    is_acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String(255))
    acknowledged_at = Column(DateTime)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<CostAnomaly {self.anomaly_type.value} ${self.amount}>"
