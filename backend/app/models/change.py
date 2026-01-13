import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import enum

from app.db.session import Base


class ChangeType(str, enum.Enum):
    DEPLOYMENT = "deployment"
    CONFIG_CHANGE = "config_change"
    SCALING = "scaling"
    MIGRATION = "migration"
    MAINTENANCE = "maintenance"
    VERSION_UPGRADE = "version_upgrade"
    FAILOVER = "failover"


class ChangeEvent(Base):
    __tablename__ = "change_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="CASCADE"), nullable=False, index=True)

    # Change details
    change_type = Column(SQLEnum(ChangeType), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)

    # What changed
    before_state = Column(JSONB)  # Snapshot before change
    after_state = Column(JSONB)   # Snapshot after change
    changed_fields = Column(JSONB)  # List of field names that changed

    # Who and when
    author = Column(String(255))
    source = Column(String(100))  # console, api, automation, etc.
    executed_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Impact assessment
    impact_score = Column(String(20))  # low, medium, high
    related_issues = Column(JSONB, default=list)  # List of issue IDs triggered by this change

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    database = relationship("Database", back_populates="change_events")

    def __repr__(self):
        return f"<ChangeEvent {self.change_type.value}: {self.title}>"
