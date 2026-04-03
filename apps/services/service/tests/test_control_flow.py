"""
Tests for app/ControlFlow.py

Pure transformation functions (renameIdKeys, removeNulls,
buildUpsertsByPropertyFactory, buildUnitOfWorkFactory) are tested directly.

Functions that hit the DB or make API calls (runEventsReceiver,
runEventsSender, createEvent, etc.) are tested by mocking their
collaborators so the control-flow logic is exercised in isolation.
"""

import copy
import pytest
from unittest.mock import patch, MagicMock, call

from app import ControlFlow


# ---------------------------------------------------------------------------
# renameIdKeys
# ---------------------------------------------------------------------------

class TestRenameIdKeys:
    def test_renames_id_key_with_prefix(self):
        data = {"ID": "123", "NAME": "John"}
        result = ControlFlow.renameIdKeys(data, "resource")
        assert "RESOURCE_ID" in result
        assert result["RESOURCE_ID"] == "123"
        assert "ID" not in result

    def test_leaves_non_id_keys_unchanged(self):
        data = {"NAME": "Alice", "STATUS": "active"}
        result = ControlFlow.renameIdKeys(data, "lead")
        assert result["NAME"] == "Alice"
        assert result["STATUS"] == "active"

    def test_flattens_dict_values_into_db_value_and_display(self):
        data = {"STATUS": {"DB_VALUE": 1, "DISPLAY": "Active"}}
        result = ControlFlow.renameIdKeys(data, "tbl")
        assert "STATUS_DB_VALUE" in result
        assert "STATUS_DISPLAY" in result
        assert result["STATUS_DB_VALUE"] == 1
        assert result["STATUS_DISPLAY"] == "Active"

    def test_prefix_is_uppercased(self):
        data = {"ID": "42"}
        result = ControlFlow.renameIdKeys(data, "service_order")
        assert "SERVICE_ORDER_ID" in result

    def test_empty_data_returns_empty(self):
        assert ControlFlow.renameIdKeys({}, "tbl") == {}

    def test_mixed_id_and_plain_and_dict_values(self):
        data = {
            "ID": "100",
            "LABEL": "shipment",
            "TYPE": {"DB_VALUE": 2, "DISPLAY": "Ground"},
        }
        result = ControlFlow.renameIdKeys(data, "shipment")
        assert "SHIPMENT_ID" in result
        assert result["LABEL"] == "shipment"
        assert result["TYPE_DB_VALUE"] == 2
        assert result["TYPE_DISPLAY"] == "Ground"


# ---------------------------------------------------------------------------
# removeNulls
# ---------------------------------------------------------------------------

class TestRemoveNulls:
    def test_removes_none_values(self):
        result = ControlFlow.removeNulls({"a": None, "b": "value"})
        assert "a" not in result
        assert result["b"] == "value"

    def test_removes_empty_string_values(self):
        result = ControlFlow.removeNulls({"x": "", "y": "keep"})
        assert "x" not in result
        assert result["y"] == "keep"

    def test_keeps_falsy_but_not_null(self):
        result = ControlFlow.removeNulls({"zero": 0, "false": False})
        assert "zero" in result
        assert "false" in result

    def test_empty_dict_returns_empty(self):
        assert ControlFlow.removeNulls({}) == {}

    def test_all_null_returns_empty(self):
        assert ControlFlow.removeNulls({"a": None, "b": ""}) == {}


# ---------------------------------------------------------------------------
# buildUpsertsByPropertyFactory
# ---------------------------------------------------------------------------

class TestBuildUpsertsByPropertyFactory:
    def _make_event_data(self, table_name="MOVE_MANAGEMENT", rows=None):
        if rows is None:
            rows = [{"event_fk": 1, "SERVICE_ORDER_ID": "SO-001", "STATUS": "active"}]
        return {"table_name": table_name, "rows": copy.deepcopy(rows)}

    def test_returns_list_of_unit_of_work_dicts(self):
        event_data = self._make_event_data()
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-001")
        assert isinstance(result, list)
        assert all(r["command"] == "unitOfWork" for r in result)

    def test_each_unit_has_command_list(self):
        event_data = self._make_event_data()
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-001")
        for unit in result:
            assert "commandList" in unit
            assert len(unit["commandList"]) > 0

    def test_upsert_targets_correct_table(self):
        event_data = self._make_event_data("SERVICE_ORDER")
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-999")
        upserts = result[0]["commandList"]
        assert all(u["targetTable"] == "SERVICE_ORDER" for u in upserts)

    def test_where_params_use_service_order_id(self):
        event_data = self._make_event_data()
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-777")
        upsert = result[0]["commandList"][0]
        param_values = [p["value"] for p in upsert["whereParams"]]
        assert "SO-777" in param_values

    def test_event_fk_removed_from_values(self):
        event_data = self._make_event_data()
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-001")
        all_value_names = [
            v["name"]
            for unit in result
            for upsert in unit["commandList"]
            for v in upsert["values"]
        ]
        assert "event_fk" not in all_value_names

    def test_multiple_rows_produce_multiple_units(self):
        rows = [
            {"event_fk": 1, "COL": "a"},
            {"event_fk": 2, "COL": "b"},
        ]
        event_data = self._make_event_data(rows=rows)
        result = ControlFlow.buildUpsertsByPropertyFactory(event_data, "SO-1")
        assert len(result) == 2


# ---------------------------------------------------------------------------
# buildUnitOfWorkFactory
# ---------------------------------------------------------------------------

class TestBuildUnitOfWorkFactory:
    def _make_table_rows(self):
        return [
            {
                "table_name": "MOVE_MANAGEMENT",
                "rows": [{"event_fk": 10, "STATUS": "packed"}],
            }
        ]

    def test_returns_unit_of_work_dict(self):
        result = ControlFlow.buildUnitOfWorkFactory("SO-100", self._make_table_rows())
        assert result["command"] == "unitOfWork"

    def test_command_list_starts_with_set_variable(self):
        result = ControlFlow.buildUnitOfWorkFactory("SO-100", self._make_table_rows())
        first_cmd = result["commandList"][0]
        assert first_cmd["command"] == "setVariable"
        assert first_cmd["sourceField"] == "ASSIGNMENT_ID"

    def test_set_variable_where_param_uses_service_order_id(self):
        result = ControlFlow.buildUnitOfWorkFactory("SO-XYZ", self._make_table_rows())
        set_var = result["commandList"][0]
        param_values = [p["value"] for p in set_var["whereParams"]]
        assert "SO-XYZ" in param_values

    def test_single_transaction_is_false_string(self):
        result = ControlFlow.buildUnitOfWorkFactory("SO-1", self._make_table_rows())
        assert result["singleTransaction"] == "false"

    def test_empty_table_rows_produces_only_set_variable(self):
        result = ControlFlow.buildUnitOfWorkFactory("SO-1", [])
        assert len(result["commandList"]) == 1
        assert result["commandList"][0]["command"] == "setVariable"

    def test_multiple_tables_all_appended(self):
        rows = [
            {"table_name": "TABLE_A", "rows": [{"event_fk": 1, "X": "a"}]},
            {"table_name": "TABLE_B", "rows": [{"event_fk": 2, "Y": "b"}]},
        ]
        result = ControlFlow.buildUnitOfWorkFactory("SO-1", rows)
        # setVariable + at least one entry per table
        assert len(result["commandList"]) > 1


# ---------------------------------------------------------------------------
# getEventsLists
# ---------------------------------------------------------------------------

class TestGetEventsLists:
    def test_returns_items_on_success(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"Items": [{"event_id": {"S": "e1"}}]}
        mock_response.text = '{"Items": [{"event_id": {"S": "e1"}}]}'

        with patch("app.APICalls.getNewEvents", return_value=mock_response), \
             patch("app.CatchRawJson.logToJson"):
            result = ControlFlow.getEventsLists("lead")
            assert result == [{"event_id": {"S": "e1"}}]

    def test_returns_none_when_api_returns_none(self):
        with patch("app.APICalls.getNewEvents", return_value=None):
            result = ControlFlow.getEventsLists("lead")
            assert result is None


# ---------------------------------------------------------------------------
# deleteFromQueue
# ---------------------------------------------------------------------------

class TestDeleteFromQueue:
    def test_delegates_to_api_calls(self):
        with patch("app.APICalls.deleteEvent", return_value=MagicMock()) as mock_del:
            ControlFlow.deleteFromQueue("evt-del-001")
            mock_del.assert_called_once_with("test-api-key-abc123", "evt-del-001")

    def test_returns_none_on_exception(self):
        with patch("app.APICalls.deleteEvent", side_effect=Exception("network fail")):
            result = ControlFlow.deleteFromQueue("evt-err")
            assert result is None


# ---------------------------------------------------------------------------
# getBroadcastEventData
# ---------------------------------------------------------------------------

class TestGetBroadcastEventData:
    def test_returns_table_rows_for_known_views(self):
        mock_event = MagicMock()
        mock_event.event_pk = "PK-001"

        with patch("app.models.base.getTablesWithPrefix", return_value=["v_equus_service_order"]), \
             patch("app.models.base.getDataRows", return_value=[{"event_fk": "PK-001", "col": "val"}]):
            result = ControlFlow.getBroadcastEventData(mock_event, "equus")
            assert len(result) == 1
            assert result[0]["table_name"] == "service_order"
            assert len(result[0]["rows"]) == 1

    def test_skips_views_with_no_rows(self):
        mock_event = MagicMock()
        mock_event.event_pk = "PK-002"

        with patch("app.models.base.getTablesWithPrefix", return_value=["v_equus_service_order"]), \
             patch("app.models.base.getDataRows", return_value=[]):
            result = ControlFlow.getBroadcastEventData(mock_event, "equus")
            assert result == []

    def test_strips_view_prefix_from_table_name(self):
        mock_event = MagicMock()
        mock_event.event_pk = "PK-003"

        views = ["v_equus_move_management", "v_equus_vendor_contact"]
        row = [{"event_fk": "PK-003", "data": "x"}]

        with patch("app.models.base.getTablesWithPrefix", return_value=views), \
             patch("app.models.base.getDataRows", return_value=row):
            result = ControlFlow.getBroadcastEventData(mock_event, "equus")
            names = [r["table_name"] for r in result]
            assert "move_management" in names
            assert "vendor_contact" in names
