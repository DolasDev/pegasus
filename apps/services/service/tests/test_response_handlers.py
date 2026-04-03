"""
Tests for app/response_handlers/response_handlers.py

All functions here are pure transformations on dicts/strings, so no DB or
network mocking is needed beyond silencing the logger (handled in conftest).
"""

import json
import pytest

from app.response_handlers.response_handlers import (
    ProcessedResponse,
    cleanNamedNumberValues,
    removeNonAscii,
    fixDataTypes,
    getProcessedResponse,
    parseEqussMilestoneResponse,
    explicitDecode,
)
from tests.conftest import make_mock_response


# ---------------------------------------------------------------------------
# cleanNamedNumberValues
# ---------------------------------------------------------------------------

class TestCleanNamedNumberValues:
    def test_leaves_non_number_keys_unchanged(self):
        assert cleanNamedNumberValues("hello world") == "hello world"

    def test_strips_non_digits_when_key_contains_number(self):
        # The function checks if 'number' is in the *value string* itself
        # (e.g. a field that happens to contain the word 'number')
        result = cleanNamedNumberValues("phone number: (555) 123-4567")
        assert result == "5551234567"

    def test_strips_letters_from_mixed_number_string(self):
        result = cleanNamedNumberValues("Order number: ABC-00123")
        assert result == "00123"

    def test_returns_original_on_non_string_input(self):
        # Exception path — non-strings fall through to the except branch
        result = cleanNamedNumberValues(None)
        assert result is None

    def test_pure_digits_with_number_keyword(self):
        result = cleanNamedNumberValues("serial number 98765")
        assert result == "98765"


# ---------------------------------------------------------------------------
# removeNonAscii
# ---------------------------------------------------------------------------

class TestRemoveNonAscii:
    def test_passes_through_plain_ascii(self):
        assert removeNonAscii("Hello, World!") == "Hello, World!"

    def test_strips_high_codepoint_characters(self):
        result = removeNonAscii("caf\u00e9")  # é = 0xE9 > 126
        assert result == "caf"

    def test_strips_control_characters(self):
        # ord < 32 are stripped (e.g. tab=9, newline=10)
        result = removeNonAscii("line1\nline2")
        assert result == "line1line2"

    def test_strips_del_character(self):
        # filter is ord < 126 AND ord > 31
        # '~' is ord 126 — NOT < 126, so it is stripped too
        # DEL is ord 127 — also stripped
        result = removeNonAscii("a~\x7f")
        assert result == "a"

    def test_returns_original_on_exception(self):
        assert removeNonAscii(None) is None

    def test_empty_string(self):
        assert removeNonAscii("") == ""


# ---------------------------------------------------------------------------
# fixDataTypes
# ---------------------------------------------------------------------------

class TestFixDataTypes:
    def test_converts_plain_integer_string(self):
        result = fixDataTypes({"count": "42"})
        assert result["count"] == 42

    def test_sets_none_for_empty_string(self):
        result = fixDataTypes({"field": ""})
        assert result["field"] is None

    def test_sets_none_for_none_value(self):
        result = fixDataTypes({"field": None})
        assert result["field"] is None

    def test_leaves_zero_prefixed_string_alone(self):
        # Values starting with '0' are not converted to int
        result = fixDataTypes({"zip": "01234"})
        assert result["zip"] == "01234"

    def test_recurses_into_nested_dict(self):
        result = fixDataTypes({"outer": {"inner": ""}})
        # Recursive call happens but the outer key itself is a dict — it stays
        assert isinstance(result["outer"], dict)

    def test_strips_non_ascii_from_unrecognised_string(self):
        # "caf\u00e9" falls through all conversions to removeNonAscii
        result = fixDataTypes({"name": "caf\u00e9"})
        assert result["name"] == "caf"


# ---------------------------------------------------------------------------
# ProcessedResponse
# ---------------------------------------------------------------------------

class TestProcessedResponse:
    def test_attributes_set_correctly(self):
        raw = {"key": "value"}
        resp = ProcessedResponse(raw_json=raw, response_dict=raw, Id="abc")
        assert resp.raw_dict is raw
        assert resp.response_dict is raw
        assert resp.Id == "abc"
        assert resp.status == "Passed"
        assert resp.errors == []

    def test_errors_list_is_independent_per_instance(self):
        r1 = ProcessedResponse({}, {}, "1")
        r2 = ProcessedResponse({}, {}, "2")
        r1.errors.append("err")
        assert r2.errors == []


# ---------------------------------------------------------------------------
# getProcessedResponse
# ---------------------------------------------------------------------------

class TestGetProcessedResponse:
    def test_returns_processed_response_instance(self):
        payload = {"Items": [{"event_id": {"S": "evt-1"}}]}
        mock_resp = make_mock_response(payload)
        result = getProcessedResponse(mock_resp, Id="evt-1")
        assert isinstance(result, ProcessedResponse)

    def test_response_dict_contains_items(self):
        payload = {"Items": [{"a": 1}]}
        mock_resp = make_mock_response(payload)
        result = getProcessedResponse(mock_resp)
        assert "Items" in result.response_dict

    def test_id_passed_through(self):
        mock_resp = make_mock_response({"Items": []})
        result = getProcessedResponse(mock_resp, Id="test-id-123")
        assert result.Id == "test-id-123"

    def test_status_is_passed(self):
        mock_resp = make_mock_response({"Items": []})
        result = getProcessedResponse(mock_resp)
        assert result.status == "Passed"


# ---------------------------------------------------------------------------
# parseEqussMilestoneResponse
# ---------------------------------------------------------------------------

class TestParseEqussMilestoneResponse:
    def _make_response(self, payload):
        return make_mock_response(payload)

    def test_parses_valid_response_with_no_errors(self):
        payload = {"IsValid": True, "Result": "OK", "ErrorMessages": []}
        result = parseEqussMilestoneResponse(self._make_response(payload))
        assert result["IsValid"] is True
        assert result["ErrorMessages"] == []

    def test_parses_embedded_json_in_error_messages(self):
        inner = json.dumps({"TechnicalErrors": ["db timeout"], "ValidationErrors": []})
        error_msg = f"Something went wrong {inner}"
        payload = {
            "IsValid": False,
            "ErrorMessages": [error_msg],
        }
        result = parseEqussMilestoneResponse(self._make_response(payload))
        assert result["IsValid"] is False
        parsed_errors = result["ErrorMessages"]
        assert len(parsed_errors) == 1
        assert parsed_errors[0]["error_message"] == "Something went wrong "
        assert parsed_errors[0]["error_details"]["TechnicalErrors"] == ["db timeout"]

    def test_falls_back_to_raw_json_on_malformed_response(self):
        # No 'ErrorMessages' key — exception path returns raw json
        payload = {"IsValid": False}
        result = parseEqussMilestoneResponse(self._make_response(payload))
        assert result == payload

    def test_multiple_error_messages_all_parsed(self):
        def make_err(msg, detail):
            inner = json.dumps({"TechnicalErrors": [detail], "ValidationErrors": []})
            return f"{msg} {inner}"

        payload = {
            "IsValid": False,
            "ErrorMessages": [
                make_err("Error A", "detail-a"),
                make_err("Error B", "detail-b"),
            ],
        }
        result = parseEqussMilestoneResponse(self._make_response(payload))
        assert len(result["ErrorMessages"]) == 2
        assert result["ErrorMessages"][0]["error_details"]["TechnicalErrors"] == ["detail-a"]
        assert result["ErrorMessages"][1]["error_details"]["TechnicalErrors"] == ["detail-b"]


# ---------------------------------------------------------------------------
# explicitDecode
# ---------------------------------------------------------------------------

class TestExplicitDecode:
    def test_none_values_become_none(self):
        result = explicitDecode({"k": None})
        assert result["k"] is None

    def test_empty_string_becomes_none(self):
        result = explicitDecode({"k": ""})
        assert result["k"] is None

    def test_string_value_passes_through_after_ascii_clean(self):
        result = explicitDecode({"k": "hello"})
        assert result["k"] == "hello"

    def test_non_ascii_stripped_from_string(self):
        result = explicitDecode({"k": "caf\u00e9"})
        assert result["k"] == "caf"
