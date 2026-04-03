"""
Tests for app/response_handlers/entity_handlers.py

Pure-logic functions (parseDynamoDB, dropUnmappedAttributes, mapToLead,
convertEventPayloadTableInserts) are tested without any DB.

Functions that touch the ORM session (getEventInstance, getOutboundEvents)
use the sqlite_engine / db_session fixtures from conftest.py.
"""

import pytest
from unittest.mock import MagicMock, patch

from app.response_handlers.entity_handlers import (
    parseDynamoDB,
    dropUnmappedAttributes,
    mapToLead,
    convertEventPayloadTableInserts,
    getEventInstance,
    getOutboundEvents,
)


# ---------------------------------------------------------------------------
# parseDynamoDB
# ---------------------------------------------------------------------------

class TestParseDynamoDB:
    def test_extracts_s_value_from_dynamodb_format(self):
        data = {"name": {"S": "John"}, "city": {"S": "Chicago"}}
        result = parseDynamoDB(data)
        assert result["name"] == "John"
        assert result["city"] == "Chicago"

    def test_leaves_plain_values_unchanged(self):
        data = {"count": 5, "label": "hello"}
        result = parseDynamoDB(data)
        assert result["count"] == 5
        assert result["label"] == "hello"

    def test_ignores_dicts_without_s_key(self):
        data = {"meta": {"N": "42"}}
        result = parseDynamoDB(data)
        # No 'S' key — original dict remains
        assert result["meta"] == {"N": "42"}

    def test_does_not_mutate_original(self):
        original = {"k": {"S": "v"}}
        parseDynamoDB(original)
        assert original["k"] == {"S": "v"}  # unchanged

    def test_empty_dict(self):
        assert parseDynamoDB({}) == {}

    def test_mixed_dynamodb_and_plain_keys(self):
        data = {"ddb": {"S": "extracted"}, "plain": "stays"}
        result = parseDynamoDB(data)
        assert result["ddb"] == "extracted"
        assert result["plain"] == "stays"


# ---------------------------------------------------------------------------
# dropUnmappedAttributes
# ---------------------------------------------------------------------------

class TestDropUnmappedAttributes:
    class _SimpleModel:
        """Minimal stand-in for an ORM model instance."""
        name = None
        status = None

    def test_keeps_attributes_present_on_model(self):
        instance = self._SimpleModel()
        data = {"name": "Alice", "status": "active"}
        result = dropUnmappedAttributes(data, instance)
        assert "name" in result
        assert "status" in result

    def test_removes_attributes_absent_from_model(self):
        instance = self._SimpleModel()
        data = {"name": "Alice", "unknown_col": "x"}
        result = dropUnmappedAttributes(data, instance)
        assert "name" in result
        assert "unknown_col" not in result

    def test_does_not_mutate_original_dict(self):
        instance = self._SimpleModel()
        data = {"name": "Alice", "garbage": "drop"}
        dropUnmappedAttributes(data, instance)
        assert "garbage" in data  # original untouched

    def test_empty_data_returns_empty(self):
        instance = self._SimpleModel()
        result = dropUnmappedAttributes({}, instance)
        assert result == {}

    def test_all_keys_present_returns_full_dict(self):
        instance = self._SimpleModel()
        data = {"name": "Bob", "status": "pending"}
        result = dropUnmappedAttributes(data, instance)
        assert result == {"name": "Bob", "status": "pending"}


# ---------------------------------------------------------------------------
# mapToLead
# ---------------------------------------------------------------------------

class TestMapToLead:
    def _make_data(self):
        return [
            {"name": "SERVICE_ORDER", "values": {"assignment_id": "A-100", "status": "active"}},
            {"name": "RESOURCE", "values": {"first_name": "Jane", "last_name": "Doe"}},
        ]

    def test_returns_property_from_matching_table(self):
        result = mapToLead(self._make_data(), "SERVICE_ORDER", "assignment_id")
        assert result == "A-100"

    def test_returns_none_for_missing_table(self):
        result = mapToLead(self._make_data(), "MISSING_TABLE", "field")
        assert result is None

    def test_returns_none_for_missing_property(self):
        result = mapToLead(self._make_data(), "SERVICE_ORDER", "nonexistent_prop")
        assert result is None

    def test_different_table(self):
        result = mapToLead(self._make_data(), "RESOURCE", "first_name")
        assert result == "Jane"

    def test_empty_data_list(self):
        result = mapToLead([], "SERVICE_ORDER", "assignment_id")
        assert result is None


# ---------------------------------------------------------------------------
# convertEventPayloadTableInserts
# ---------------------------------------------------------------------------

class TestConvertEventPayloadTableInserts:
    def test_generates_insert_with_valid_columns(self):
        valid_cols = ["first_name", "last_name", "assignment_id"]
        data = {"first_name": "Jane", "last_name": "Doe", "assignment_id": "A-1", "extra": "ignored"}
        sql = convertEventPayloadTableInserts("equus_resource", valid_cols, data)
        assert sql.startswith("INSERT INTO equus_resource")
        assert "first_name" in sql
        assert "last_name" in sql
        assert "extra" not in sql

    def test_uses_named_placeholders(self):
        valid_cols = ["name"]
        data = {"name": "test"}
        sql = convertEventPayloadTableInserts("my_table", valid_cols, data)
        assert ":name" in sql

    def test_excludes_data_keys_not_in_valid_columns(self):
        valid_cols = ["alpha"]
        data = {"alpha": 1, "beta": 2, "gamma": 3}
        sql = convertEventPayloadTableInserts("orders", valid_cols, data)
        # Only 'alpha' column should appear; beta/gamma must be absent
        assert "beta" not in sql
        assert "gamma" not in sql
        assert "alpha" in sql

    def test_correct_table_name_in_sql(self):
        sql = convertEventPayloadTableInserts(
            "equus_service_order", ["id"], {"id": 42}
        )
        assert "equus_service_order" in sql

    def test_all_valid_columns_included(self):
        valid_cols = ["col1", "col2"]
        data = {"col1": "v1", "col2": "v2"}
        sql = convertEventPayloadTableInserts("t", valid_cols, data)
        assert "col1" in sql
        assert "col2" in sql
        assert ":col1" in sql
        assert ":col2" in sql


# ---------------------------------------------------------------------------
# getEventInstance  (requires ORM session)
# ---------------------------------------------------------------------------

class TestGetEventInstance:
    def _make_raw_event(self, event_id="evt-abc-001"):
        return {
            "event_id": {"S": event_id},
            "event_type": {"S": "lead"},
            "event_datetime": {"S": "2026-01-01T00:00:00Z"},
            "event_status": {"S": "NEW"},
            "event_publisher": {"S": "equus"},
            "event_data": {"S": {"tables": []}},
        }

    def _mock_session_manager(self, first_result):
        """Return a mock SessionManager instance with a pre-configured query chain."""
        mock_sm = MagicMock()
        mock_sm.current_session.query.return_value.filter_by.return_value.first.return_value = first_result
        return mock_sm

    def test_returns_event_instance_with_correct_fields(self, db_session):
        with patch("app.models.base.SessionManager", return_value=self._mock_session_manager(None)):
            event = getEventInstance(self._make_raw_event())
            assert event.event_id == "evt-abc-001"
            assert event.event_type == "lead"
            assert event.event_publisher == "equus"

    def test_sets_id_when_duplicate_exists(self, db_session):
        from app.models.Events import Event

        existing = Event()
        existing.id = 99
        existing.event_id = "evt-dup"

        with patch("app.models.base.SessionManager", return_value=self._mock_session_manager(existing)):
            event = getEventInstance(self._make_raw_event("evt-dup"))
            assert event.id == 99

    def test_id_is_none_for_new_event(self, db_session):
        with patch("app.models.base.SessionManager", return_value=self._mock_session_manager(None)):
            event = getEventInstance(self._make_raw_event("evt-brand-new"))
            assert event.id is None


# ---------------------------------------------------------------------------
# getOutboundEvents  (requires ORM session)
# ---------------------------------------------------------------------------

class TestGetOutboundEvents:
    def _mock_session_manager(self, all_result=None):
        mock_sm = MagicMock()
        mock_sm.current_session.query.return_value.filter_by.return_value.all.return_value = (
            all_result or []
        )
        return mock_sm

    def test_returns_list(self, db_session):
        with patch("app.models.base.SessionManager", return_value=self._mock_session_manager()):
            result = getOutboundEvents()
            assert isinstance(result, list)

    def test_filters_by_new_status_and_equus_group(self, db_session):
        mock_sm = self._mock_session_manager()
        with patch("app.models.base.SessionManager", return_value=mock_sm):
            getOutboundEvents()
            mock_sm.current_session.query.return_value.filter_by.assert_called_once_with(
                event_status="NEW", event_group="equus"
            )
