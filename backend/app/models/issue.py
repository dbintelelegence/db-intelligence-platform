import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import relationship
import enum

from app.db.session import Base


class IssueSeverity(str, enum.Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class IssueCategory(str, enum.Enum):
    PERFORMANCE = "performance"
    CAPACITY = "capacity"
    AVAILABILITY = "availability"
    CONFIGURATION = "configuration"
    COST = "cost"
    SECURITY = "security"


class IssueStatus(str, enum.Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class Issue(Base):
    __tablename__ = "issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="CASCADE"), nullable=False, index=True)

    # Issue details
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    severity = Column(SQLEnum(IssueSeverity), nullable=False, index=True)
    category = Column(SQLEnum(IssueCategory), nullable=False, index=True)
    status = Column(SQLEnum(IssueStatus), default=IssueStatus.ACTIVE, index=True)

    # AI-generated content
    ai_explanation = Column(Text)
    ai_recommendations = Column(ARRAY(String))

    # Related data
    related_metrics = Column(JSONB, default=list)  # List of metric names/values
    affected_services = Column(ARRAY(String), default=list)

    # Tracking
    occurrence_count = Column(Integer, default=1)
    first_detected_at = Column(DateTime, default=datetime.utcnow)
    last_detected_at = Column(DateTime, default=datetime.utcnow)
    acknowledged_at = Column(DateTime)
    acknowledged_by = Column(String(255))
    resolved_at = Column(DateTime)
    resolved_by = Column(String(255))

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    database = relationship("Database", back_populates="issues")

    def __repr__(self):
        return f"<Issue {self.title} ({self.severity.value})>"
