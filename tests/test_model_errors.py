"""New-flagship rollout (2026-07-14): GPT-5.6 Sol/Terra/Luna + Claude Fable 5 in the
matrix, both families' flagships as defaults, and friendly errors when an account can't
use them (GPT-5.6 rolls out per-organization; quota/credits can run out on any model).
"""

from coworker.config import Config
from coworker.providers.errors import friendly_model_error
from coworker.providers.matrix import MATRIX, models_for_provider
from coworker.providers.registry import get_descriptor


def test_new_flagships_in_matrix_with_labels():
    for mid, label in {
        "gpt-5.6-sol": "GPT-5.6 Sol · OpenAI",
        "gpt-5.6-terra": "GPT-5.6 Terra · OpenAI",
        "gpt-5.6-luna": "GPT-5.6 Luna · OpenAI",
        "anthropic:claude-fable-5": "Claude Fable 5 · Anthropic",
    }.items():
        assert MATRIX[mid].label == label
        assert MATRIX[mid].caps.tools and MATRIX[mid].caps.vision

    assert "gpt-5.6-sol" in models_for_provider("openai")
    assert "claude-fable-5" in models_for_provider("anthropic")


def test_flagships_are_the_defaults():
    # The app-wide default routes through Qumge (Marlo's one-key gateway); the per-vendor
    # descriptors below still recommend their own native flagships for direct-key setups.
    assert Config().model == "qumge:deepseek/deepseek-v4-flash"
    assert get_descriptor("openai").recommended_model == "gpt-5.6-sol"
    assert get_descriptor("anthropic").recommended_model == "claude-fable-5"


def test_config_default_model_is_tied_to_the_qumge_descriptor():
    """Both sides carry the SAME id as an independent literal — changing the recommended
    model (registry.py) without also changing the config default (config.py) stays green
    everywhere else, since nothing else compares them. This assertion is the one place
    that would fail if they drift apart."""
    assert Config().model == f"qumge:{get_descriptor('qumge').recommended_model}"


# -- friendly access/quota errors --------------------------------------------------------
def test_no_access_errors_are_translated():
    # OpenAI's 404/403 body for a model the org can't use yet
    exc = RuntimeError(
        "Error code: 404 - {'error': {'code': 'model_not_found', 'message': "
        "'The model `gpt-5.6-sol` does not exist or you do not have access to it.'}}"
    )
    msg = friendly_model_error("gpt-5.6-sol", exc)
    assert msg and "doesn't have access to gpt-5.6-sol" in msg

    # Anthropic's 404 body is type not_found_error + "model: <id>"
    exc = RuntimeError(
        "Error code: 404 - {'type': 'error', 'error': {'type': 'not_found_error', "
        "'message': 'model: claude-fable-5'}}"
    )
    msg = friendly_model_error("anthropic:claude-fable-5", exc)
    assert msg and "doesn't have access to anthropic:claude-fable-5" in msg


def test_quota_errors_are_translated():
    exc = RuntimeError(
        "Error code: 429 - {'error': {'code': 'insufficient_quota', 'message': "
        "'You exceeded your current quota, please check your plan and billing details.'}}"
    )
    msg = friendly_model_error("gpt-5.6-sol", exc)
    assert msg and "out of quota for gpt-5.6-sol" in msg

    exc = RuntimeError(
        "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', "
        "'message': 'Your credit balance is too low to access the Anthropic API.'}}"
    )
    msg = friendly_model_error("anthropic:claude-fable-5", exc)
    assert msg and "out of quota" in msg


def test_unrelated_errors_pass_through_raw():
    # a plain rate-limit (429 without a quota code) must NOT be dressed up
    assert (
        friendly_model_error(
            "gpt-5.6-sol",
            RuntimeError("Error code: 429 - rate_limit_exceeded, retry after 2s"),
        )
        is None
    )
    # a 404 from a wrong base_url isn't an access problem
    assert (
        friendly_model_error(
            "gpt-5.6-sol", RuntimeError("Error code: 404 - no route /v2/chat")
        )
        is None
    )
    assert (
        friendly_model_error("gpt-5.6-sol", RuntimeError("connection reset by peer"))
        is None
    )


# -- gateway 402 (no credit) -------------------------------------------------------------
class _Status402(Exception):
    """OpenAI SDK 的 APIStatusError 形状：状态码在属性上，不在字符串里。"""

    status_code = 402


def test_gateway_402_reads_as_out_of_credit():
    from coworker.providers import errors

    msg = friendly_model_error("qumge:deepseek/deepseek-v4-flash", _Status402("Payment Required"))
    # 身份，不是「含有 credit 这个词」—— engine 就是靠这个身份决定要不要挂充值按钮
    assert msg is errors.NO_CREDIT


def test_402_is_matched_on_the_code_not_on_guessed_body_text():
    """Qumge 网关的 body 措辞我们不知道，也不该猜。402 只有一个含义。"""

    class _Bare(Exception):
        status_code = 402

    assert friendly_model_error("qumge:x", _Bare("")) is not None


def test_text_fallback_when_the_sdk_swallowed_the_status_code():
    from coworker.providers import errors

    # 身份，不是 is not None —— 把 "insufficient balance" 误加进 _NO_QUOTA 而不是
    # _NO_CREDIT_TEXT 的实现会返回「配额」那句话，is not None 照样绿
    assert friendly_model_error("qumge:x", Exception("insufficient balance")) is errors.NO_CREDIT


def test_404_and_429_are_unaffected():
    class _NotFound(Exception):
        status_code = 404

    class _RateLimited(Exception):
        status_code = 429

    # 一码多义：404 也可能是 base_url 写错，429 也可能只是让你慢点
    assert friendly_model_error("qumge:x", _NotFound("upstream boom")) is None
    assert friendly_model_error("qumge:x", _RateLimited("slow down")) is None


def test_402_is_gated_on_qumge_models_only():
    """NO_CREDIT names Qumge by name and points at Qumge's sidebar account row. A BYO-key
    user behind a corporate proxy or metered relay that answers 402 must NOT be told their
    *Qumge* balance is empty and sent to a row that (being signed out) shows them nothing."""
    from coworker.providers import errors

    assert friendly_model_error("gpt-5.6-sol", _Status402("Payment Required")) is None
    assert friendly_model_error("anthropic:claude-fable-5", _Status402("Payment Required")) is None
    assert (
        friendly_model_error("qumge:deepseek/deepseek-v4-flash", _Status402("Payment Required"))
        is errors.NO_CREDIT
    )


def test_text_fallback_is_also_gated_on_qumge_models_only():
    """Same gate as the status-code branch — a non-Qumge model saying "insufficient
    balance" for whatever reason of its own must not be dressed up as a Qumge failure."""
    assert friendly_model_error("gpt-5.6-sol", Exception("insufficient balance")) is None


def test_402_status_wins_over_quota_body_text_ordering():
    """A gateway 402 whose body happens to read like a quota message ("credit balance is
    too low" is also one of _NO_QUOTA's markers) must still resolve through the
    identity-checked NO_CREDIT, not the interpolated quota sentence — otherwise
    `friendly is NO_CREDIT` goes false and the top-up button silently vanishes exactly
    when the wording collides."""
    from coworker.providers import errors

    class _AmbiguousBody(Exception):
        status_code = 402

    exc = _AmbiguousBody("credit balance is too low")
    assert friendly_model_error("qumge:x", exc) is errors.NO_CREDIT


# -- 402 top-up URL extraction ------------------------------------------------------------
# THE TRAP: the OpenAI SDK unwraps the response body's `error` sub-object into
# `.body`, so the gateway's sibling `topup_url` key is NOT there — only
# `exc.response.json()` has the full body. A hand-built exception can't reproduce
# that SDK behavior, so the realistic test below drives the real `openai` SDK
# against a local stub HTTP server serving the actual gateway 402 shape.
import http.server
import json as _json
import threading

import pytest


class _Gateway402Handler(http.server.BaseHTTPRequestHandler):
    BODY = _json.dumps(
        {
            "error": {"code": "insufficient_balance", "message": "Wallet balance insufficient"},
            "topup_url": "https://qumge.com/en/gateway/topup/new",
            "docs_url": "https://qumge.com/en/docs/gateway",
        }
    ).encode()

    def do_POST(self):
        self.send_response(402)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(self.BODY)))
        self.end_headers()
        self.wfile.write(self.BODY)

    def log_message(self, *args):  # keep test output quiet
        pass


@pytest.fixture
def qumge_402_base_url():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Gateway402Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        server.shutdown()
        thread.join()


def _real_402_exception(base_url: str) -> Exception:
    from openai import OpenAI

    client = OpenAI(api_key="x", base_url=base_url, max_retries=0)
    try:
        client.chat.completions.create(model="m", messages=[{"role": "user", "content": "hi"}])
    except Exception as exc:  # this IS the thing under test
        return exc
    raise AssertionError("expected the stub 402 to raise")


def test_no_credit_topup_url_reads_the_real_402_body(qumge_402_base_url):
    from coworker.providers.errors import no_credit_topup_url

    exc = _real_402_exception(qumge_402_base_url)
    # The trap, made falsifiable: if the SDK ever starts putting `topup_url` on
    # `.body`, this goes red first and `no_credit_topup_url` needs a rewrite.
    assert "topup_url" not in (exc.body or {})
    assert no_credit_topup_url(exc) == "https://qumge.com/en/gateway/topup/new"


def test_no_credit_topup_url_missing_response_is_none():
    from coworker.providers.errors import no_credit_topup_url

    class _NoResponse(Exception):
        pass

    assert no_credit_topup_url(_NoResponse("boom")) is None


class _WithResponse(Exception):
    """Carries a real httpx.Response, exercising the same `.response.json()` path
    as the real SDK exception without needing a server for every edge case."""

    def __init__(self, response):
        super().__init__("boom")
        self.response = response


def test_no_credit_topup_url_non_json_body_is_none():
    import httpx

    from coworker.providers.errors import no_credit_topup_url

    exc = _WithResponse(httpx.Response(402, text="not json"))
    assert no_credit_topup_url(exc) is None


def test_no_credit_topup_url_missing_key_is_none():
    import httpx

    from coworker.providers.errors import no_credit_topup_url

    body = _json.dumps({"error": {"code": "insufficient_balance", "message": "x"}})
    exc = _WithResponse(httpx.Response(402, text=body))
    assert no_credit_topup_url(exc) is None


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "not a url",
        "ftp://qumge.com/topup",
        # 方案正确的 scheme + 空 netloc。上面几条【只靠 scheme 那半边守卫就全被挡了】，
        # 所以把 `or not parsed.netloc` 删掉，它们照样全绿（review 实测过 46 条全过）。
        # 这一条是唯一能钉住 netloc 那半边的。
        "https:///no-host",
        "",
        "/relative/path",
    ],
)
def test_no_credit_topup_url_rejects_non_http_values(bad_url):
    import httpx

    from coworker.providers.errors import no_credit_topup_url

    body = _json.dumps({"error": {}, "topup_url": bad_url})
    exc = _WithResponse(httpx.Response(402, text=body))
    assert no_credit_topup_url(exc) is None


def test_no_credit_topup_url_not_gated_on_the_model():
    """Unlike friendly_model_error, this extractor takes no `model` argument at
    all — the caller already knows it's a Qumge 402 before it asks for the link."""
    import inspect

    from coworker.providers import errors

    assert list(inspect.signature(errors.no_credit_topup_url).parameters) == ["exc"]
