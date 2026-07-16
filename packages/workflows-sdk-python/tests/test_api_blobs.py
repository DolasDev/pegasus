"""Tests for the blob client methods (sdk-feedback/0025).

httpx.MockTransport serves both the API (presign) call and the absolute S3
PUT/GET, so put_blob/get_blob exercise the full two-hop flow offline.
"""

from __future__ import annotations

import json

import httpx

from pegasus_workflows.api import PegasusClient

_TOKEN = "vnd_" + "a" * 48


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="http://api.test", token=_TOKEN, transport=httpx.MockTransport(handler)
    )


def test_put_blob_mints_url_then_uploads_to_s3() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/blobs/upload-url":
            seen["presign_body"] = json.loads(request.read())
            return httpx.Response(
                201,
                json={
                    "data": {
                        "blobId": "b-1",
                        "uploadUrl": "http://s3.test/put/b-1",
                        "expiresInSeconds": 900,
                    }
                },
            )
        # The absolute S3 PUT.
        seen["s3_put_url"] = str(request.url)
        seen["s3_body"] = request.read()
        seen["s3_ct"] = request.headers.get("Content-Type")
        return httpx.Response(200)

    client = _client_with(handler)
    result = client.put_blob(b"hello-bytes", "application/pdf")

    assert result == {"blobId": "b-1", "size": 11}
    assert seen["presign_body"] == {"contentType": "application/pdf", "sizeBytes": 11}
    assert seen["s3_put_url"] == "http://s3.test/put/b-1"
    assert seen["s3_body"] == b"hello-bytes"
    assert seen["s3_ct"] == "application/pdf"


def test_get_blob_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/blobs/b-9/download-url"
        return httpx.Response(
            200,
            json={
                "data": {
                    "downloadUrl": "http://s3.test/get/b-9",
                    "expiresInSeconds": 300,
                    "size": 42,
                }
            },
        )

    data = _client_with(handler).get_blob_url("b-9")
    assert data["downloadUrl"] == "http://s3.test/get/b-9"
    assert data["size"] == 42


def test_get_blob_downloads_bytes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/blobs/b-9/download-url":
            return httpx.Response(
                200,
                json={"data": {"downloadUrl": "http://s3.test/get/b-9", "expiresInSeconds": 300}},
            )
        return httpx.Response(200, content=b"the-image-bytes")

    got = _client_with(handler).get_blob("b-9")
    assert got == b"the-image-bytes"


def test_call_external_response_to_blob_sends_flag() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.read())
        return httpx.Response(
            200,
            json={
                "data": {"status": 200, "ok": True, "blobId": "b-2", "size": 10, "dryRun": False}
            },
        )

    client = _client_with(handler)
    res = client.call_external(
        "sirva_ade_document", method="GET", path="/IMAGING/m2/GetImage", response_to_blob=True
    )
    assert seen["body"]["responseToBlob"] is True
    assert res["blobId"] == "b-2"
