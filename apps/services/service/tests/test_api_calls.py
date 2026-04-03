"""
Tests for app/APICalls.py

All outbound HTTP calls are intercepted with unittest.mock.patch so no
real network traffic is made. The fake config (injected in conftest.py)
sets api_base_url = 'http://test-api.example.com'.
"""

import pytest
from unittest.mock import patch, MagicMock
from requests.exceptions import HTTPError, ConnectionError as RequestsConnectionError

from app import APICalls


BASE_URL = "http://test-api.example.com"
API_KEY = "test-api-key-abc123"


def _mock_response(status_code=200, json_body=None):
    m = MagicMock()
    m.status_code = status_code
    m.json.return_value = json_body or {}
    if status_code >= 400:
        m.raise_for_status.side_effect = HTTPError(response=m)
    else:
        m.raise_for_status.return_value = None
    return m


# ---------------------------------------------------------------------------
# getNewEvents
# ---------------------------------------------------------------------------

class TestGetNewEvents:
    def test_sends_get_to_correct_url(self):
        with patch("requests.get", return_value=_mock_response(200, {"Items": []})) as mock_get:
            APICalls.getNewEvents(API_KEY, "lead")
            mock_get.assert_called_once()
            url = mock_get.call_args[0][0]
            assert url == f"{BASE_URL}/events/lead"

    def test_includes_bearer_token_header(self):
        with patch("requests.get", return_value=_mock_response(200, {"Items": []})) as mock_get:
            APICalls.getNewEvents(API_KEY, "lead")
            headers = mock_get.call_args[1]["headers"]
            assert headers["Authorization"] == f"Bearer {API_KEY}"

    def test_returns_response_on_success(self):
        mock_resp = _mock_response(200, {"Items": [{"event_id": {"S": "e1"}}]})
        with patch("requests.get", return_value=mock_resp):
            result = APICalls.getNewEvents(API_KEY, "lead")
            assert result is mock_resp

    def test_returns_none_on_http_error(self):
        with patch("requests.get", return_value=_mock_response(500)):
            result = APICalls.getNewEvents(API_KEY, "lead")
            assert result is None

    def test_returns_none_on_connection_error(self):
        with patch("requests.get", side_effect=RequestsConnectionError("timeout")):
            result = APICalls.getNewEvents(API_KEY, "lead")
            assert result is None

    def test_event_type_is_included_in_url(self):
        with patch("requests.get", return_value=_mock_response()) as mock_get:
            APICalls.getNewEvents(API_KEY, "milestone-update")
            url = mock_get.call_args[0][0]
            assert "milestone-update" in url


# ---------------------------------------------------------------------------
# sendEquusMilestone
# ---------------------------------------------------------------------------

class TestSendEquusMilestone:
    _milestone_body = {
        "command": "unitOfWork",
        "singleTransaction": "false",
        "commandList": [],
    }

    def test_sends_post_to_base_url(self):
        with patch("requests.post", return_value=_mock_response(200, {"IsValid": True})) as mock_post:
            APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            mock_post.assert_called_once()
            url = mock_post.call_args[0][0]
            assert url == BASE_URL

    def test_includes_required_headers(self):
        with patch("requests.post", return_value=_mock_response(200, {"IsValid": True})) as mock_post:
            APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            headers = mock_post.call_args[1]["headers"]
            assert headers["Authorization"] == f"Bearer {API_KEY}"
            assert "assignmentproinstanceid" in headers
            assert "vendorid" in headers
            assert "assignmentprocompanyid" in headers

    def test_sends_json_body(self):
        with patch("requests.post", return_value=_mock_response(200, {"IsValid": True})) as mock_post:
            APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            sent_json = mock_post.call_args[1]["json"]
            assert sent_json == self._milestone_body

    def test_returns_response_on_success(self):
        mock_resp = _mock_response(200, {"IsValid": True})
        with patch("requests.post", return_value=mock_resp):
            result = APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            assert result is mock_resp

    def test_returns_none_on_http_error(self):
        with patch("requests.post", return_value=_mock_response(422)):
            result = APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            assert result is None

    def test_returns_none_on_network_failure(self):
        with patch("requests.post", side_effect=RequestsConnectionError("refused")):
            result = APICalls.sendEquusMilestone(API_KEY, self._milestone_body)
            assert result is None


# ---------------------------------------------------------------------------
# deleteEvent
# ---------------------------------------------------------------------------

class TestDeleteEvent:
    def test_sends_delete_to_correct_url(self):
        with patch("requests.delete", return_value=_mock_response(200)) as mock_del:
            APICalls.deleteEvent(API_KEY, "evt-xyz-789")
            mock_del.assert_called_once()
            url = mock_del.call_args[0][0]
            assert url == f"{BASE_URL}/events/evt-xyz-789"

    def test_includes_bearer_token(self):
        with patch("requests.delete", return_value=_mock_response(200)) as mock_del:
            APICalls.deleteEvent(API_KEY, "evt-1")
            headers = mock_del.call_args[1]["headers"]
            assert headers["Authorization"] == f"Bearer {API_KEY}"

    def test_returns_response_on_success(self):
        mock_resp = _mock_response(204)
        mock_resp.raise_for_status.return_value = None
        with patch("requests.delete", return_value=mock_resp):
            result = APICalls.deleteEvent(API_KEY, "evt-1")
            assert result is mock_resp

    def test_returns_none_on_http_error(self):
        with patch("requests.delete", return_value=_mock_response(404)):
            result = APICalls.deleteEvent(API_KEY, "evt-1")
            assert result is None

    def test_returns_none_on_connection_error(self):
        with patch("requests.delete", side_effect=RequestsConnectionError("gone")):
            result = APICalls.deleteEvent(API_KEY, "evt-1")
            assert result is None

    def test_event_id_encoded_in_url(self):
        with patch("requests.delete", return_value=_mock_response(200)) as mock_del:
            APICalls.deleteEvent(API_KEY, "special-event-id-9999")
            url = mock_del.call_args[0][0]
            assert "special-event-id-9999" in url
