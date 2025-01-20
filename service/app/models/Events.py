import datetime
from sqlalchemy import Column, String, Integer, DateTime
from app.models.base import Base


class Event(Base):
    __tablename__ = 'pegasus_api_events'
    __table_args__ = {'implicit_returning': False}  # This is to allow triggers on tables

    id = Column('id', Integer, primary_key=True)
    event_id = Column(String)
    event_type = Column(String)
    event_datetime = Column(String)
    event_status = Column(String)
    event_publisher = Column(String)
    event_data = Column(String)
    received_date = Column(DateTime, default=datetime.datetime.now)
    
    def __repr__(self):
        return (str(self.id) + self.event_type)
    

class BoadcastEvent(Base):
    __tablename__ = 'pegasus_broadcast_events'
    __table_args__ = {'implicit_returning': False}  # This is to allow triggers on tables

    id = Column('id', Integer, primary_key=True)
    event_type = Column(String)
    event_group = Column(String)
    event_datetime = Column(DateTime, default=datetime.datetime.now)
    event_status = Column(String, default='NEW')
    event_pk = Column(String)
    event_view_prefix = Column(String)
    event_processed = Column(String)
    event_response = Column(String)
    
    def __repr__(self):
        return (str(self.id) + self.event_type)
