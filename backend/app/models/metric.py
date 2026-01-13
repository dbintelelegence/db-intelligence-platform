import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.session import Base


class Metric(Base):
    __tablename__ = "metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="CASCADE"), nullable=False)

    # Metric identification
    name = Column(String(100), nullable=False)  # cpu_usage, memory_usage, etc.
    value = Column(Float, nullable=False)
    unit = Column(String(20))  # percent, bytes, ms, count

    # Timestamp for time-series
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    database = relationship("Database", back_populates="metrics")

    # Composite index for efficient time-series queries
    __table_args__ = (
        Index("ix_metrics_database_name_timestamp", "database_id", "name", "timestamp"),
    )

    def __repr__(self):
        return f"<Metric {self.name}={self.value} at {self.timestamp}>"
