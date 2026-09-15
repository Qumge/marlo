"""Qumge 网关的请求体 gzip（2026-09-15）。

网关前面那层 Cloudflare WAF 会拦含某些字样的明文请求体；带 Content-Encoding: gzip 就能过边缘
（网关解回来）。这里用【真 openai SDK】打本地 stub，验证：只有 Qumge 主机的请求被压、别的原样、
重试不叠压、流式也压、【走代理照样压】。最后一条是这套方案存在的理由 —— 自定义 transport 会在
代理用户身上被绕过，事件钩子不会。

代理旁路：这台机器全局设了 http(s)_proxy / all_proxy 指向本地 clash（见任务说明）。打 127.0.0.1
的直连测试必须把这些删掉，不然请求会绕经 clash；代理那条测试则显式只留自己那个转发代理。
"""

from __future__ import annotations

import gzip
import http.client
import http.server
import json
import threading
from urllib.parse import urlsplit

import pytest
from openai import DefaultHttpxClient, OpenAI

from coworker.providers.openai_provider import (
    OpenAIProvider,
    _gzip_qumge_request,
    _is_qumge_base_url,
)

_PROXY_ENV = (
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
)


def _no_proxies(monkeypatch):
    """把继承来的代理环境变量全清掉，让 openai/httpx 直连 127.0.0.1 的 stub。"""
    for k in _PROXY_ENV:
        monkeypatch.delenv(k, raising=False)


_COMPLETION = {
    "id": "chatcmpl-stub",
    "object": "chat.completion",
    "created": 0,
    "model": "m",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "hello"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
}

# 两个流式分片 + [DONE]；SDK 的 Stream 按 SSE 解析。
_SSE = (
    'data: {"id":"chatcmpl-stub","object":"chat.completion.chunk","created":0,'
    '"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
    'data: {"id":"chatcmpl-stub","object":"chat.completion.chunk","created":0,'
    '"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
    "data: [DONE]\n\n"
).encode()


class _RecordingHandler(http.server.BaseHTTPRequestHandler):
    """记录每个 POST 的 Content-Encoding 和原始 body，然后回一个 SDK 能解析的补全。

    `server.fail_first` > 0 时先回 500（可重试状态码），用来测重试。始终先记录再决定回什么。
    """

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        enc = self.headers.get("Content-Encoding")
        decoded = gzip.decompress(raw) if enc == "gzip" else raw
        try:
            payload = json.loads(decoded)
        except Exception:
            payload = {}
        self.server.records.append(
            {"content_encoding": enc, "raw_body": raw, "decoded": decoded, "json": payload}
        )

        if getattr(self.server, "fail_first", 0) > 0:
            self.server.fail_first -= 1
            self._send(500, b'{"error":{"message":"transient"}}', "application/json")
            return

        if payload.get("stream"):
            self._send(200, _SSE, "text/event-stream")
        else:
            self._send(200, json.dumps(_COMPLETION).encode(), "application/json")

    def _send(self, status, body, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 保持测试输出安静
        pass


class _ForwardProxyHandler(http.server.BaseHTTPRequestHandler):
    """最小 HTTP 转发代理：httpx 对 http:// 目标走转发模式，请求行里是绝对 URL。原样转给上游
    （body 和 Content-Encoding 都不动），把上游响应回传。也自己记一份，方便断言。"""

    def do_POST(self):
        target = urlsplit(self.path)  # 绝对形式：http://host:port/path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        self.server.records.append(
            {"content_encoding": self.headers.get("Content-Encoding"), "raw_body": body}
        )
        conn = http.client.HTTPConnection(target.hostname, target.port, timeout=10)
        fwd = {
            k: v
            for k, v in self.headers.items()
            if k.lower() not in ("host", "proxy-connection", "connection")
        }
        conn.request("POST", target.path or "/", body=body, headers=fwd)
        up = conn.getresponse()
        data = up.read()
        self.send_response(up.status)
        for k, v in up.getheaders():
            if k.lower() in ("transfer-encoding", "connection", "content-length"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class _Server:
    """起一个后台 HTTP 服务，`.records` 收请求，`.url` 是根地址。"""

    def __init__(self, handler_cls):
        self._srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        self._srv.records = []
        self._srv.fail_first = 0
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()

    @property
    def records(self):
        return self._srv.records

    @property
    def fail_first(self):
        return self._srv.fail_first

    @fail_first.setter
    def fail_first(self, n):
        self._srv.fail_first = n

    @property
    def url(self):
        return f"http://127.0.0.1:{self._srv.server_port}"

    def stop(self):
        self._srv.shutdown()
        self._thread.join()


@pytest.fixture
def recorder():
    srv = _Server(_RecordingHandler)
    try:
        yield srv
    finally:
        srv.stop()


@pytest.fixture
def forward_proxy():
    srv = _Server(_ForwardProxyHandler)
    try:
        yield srv
    finally:
        srv.stop()


def _mark_qumge(monkeypatch, root_url):
    """让 stub 的主机算作 Qumge 网关：QUMGE_BASE_URL 指到 stub 根。"""
    monkeypatch.setenv("QUMGE_BASE_URL", root_url)


def _qumge_client(base_url, **kwargs):
    """照 _ensure_client 的 Qumge 分支那样建 SDK 客户端（挂 gzip 钩子、保留 SDK 默认值），
    但允许传 max_retries 之类 —— 重试测试要用。"""
    return OpenAI(
        api_key="x",
        base_url=base_url,
        http_client=DefaultHttpxClient(event_hooks={"request": [_gzip_qumge_request]}),
        **kwargs,
    )


# -- 纯单元：主机判定 --------------------------------------------------------------------
def test_scope_matches_only_the_gateway_host(monkeypatch):
    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)
    assert _is_qumge_base_url("https://qumge.com/v1") is True
    assert _is_qumge_base_url("https://qumge.com:443/v1") is True  # 端口不参与
    assert _is_qumge_base_url("https://api.openai.com/v1") is False
    assert _is_qumge_base_url("https://evil-qumge.com/v1") is False  # 不是子串匹配
    assert _is_qumge_base_url(None) is False
    # QUMGE_BASE_URL 覆盖后，只有那台主机算网关
    monkeypatch.setenv("QUMGE_BASE_URL", "https://staging.qumge.com/")
    assert _is_qumge_base_url("https://staging.qumge.com/v1") is True
    assert _is_qumge_base_url("https://qumge.com/v1") is False


# -- (a) Qumge 主机：请求带 gzip，解出来正是 SDK 要发的 JSON，响应正常解析 -----------------
def test_qumge_request_is_gzipped_and_roundtrips(monkeypatch, recorder):
    _no_proxies(monkeypatch)
    _mark_qumge(monkeypatch, recorder.url)

    provider = OpenAIProvider(base_url=recorder.url + "/v1", api_key="x")
    turn = provider.complete(
        model="m", messages=[{"role": "user", "content": "hi there"}]
    )

    assert turn.text == "hello"  # SDK 正常解析了 stub 的响应
    assert len(recorder.records) == 1
    rec = recorder.records[0]
    assert rec["content_encoding"] == "gzip"
    assert rec["raw_body"][:2] == b"\x1f\x8b"  # gzip 魔数
    body = json.loads(gzip.decompress(rec["raw_body"]))
    assert body["model"] == "m"
    assert body["messages"] == [{"role": "user", "content": "hi there"}]


# -- (b) 非 Qumge 主机：明文、无 Content-Encoding ----------------------------------------
def test_non_qumge_request_is_not_compressed(monkeypatch, recorder):
    _no_proxies(monkeypatch)
    monkeypatch.delenv("QUMGE_BASE_URL", raising=False)  # 网关主机保持 qumge.com

    # stub 在 127.0.0.1，主机不是 qumge.com → 不该压
    provider = OpenAIProvider(base_url=recorder.url + "/v1", api_key="x")
    turn = provider.complete(model="m", messages=[{"role": "user", "content": "hi"}])

    assert turn.text == "hello"
    assert len(recorder.records) == 1
    rec = recorder.records[0]
    assert rec["content_encoding"] is None
    assert rec["raw_body"][:2] != b"\x1f\x8b"
    assert json.loads(rec["raw_body"])["model"] == "m"  # 就是明文 JSON


# -- (c) 重试：500 一次再 200，压且只压一次（不叠 gzip）----------------------------------
def test_retry_is_compressed_exactly_once(monkeypatch, recorder):
    _no_proxies(monkeypatch)
    _mark_qumge(monkeypatch, recorder.url)
    recorder.fail_first = 1

    # 注入照生产方式建的客户端，但 max_retries=1，让 SDK 内部重试一次
    provider = OpenAIProvider(client=_qumge_client(recorder.url + "/v1", max_retries=1))
    turn = provider.complete(model="m", messages=[{"role": "user", "content": "hi"}])

    assert turn.text == "hello"
    assert len(recorder.records) == 2  # 第一次 500，重试第二次 200
    for rec in recorder.records:
        assert rec["content_encoding"] == "gzip"
        # 解一次就是 JSON —— 若被叠压两次，解一次得到的还是 gzip 字节，json.loads 会炸
        assert json.loads(gzip.decompress(rec["raw_body"]))["model"] == "m"
        assert rec["decoded"][:2] != b"\x1f\x8b"


# -- (d) 流式：请求体一样压 --------------------------------------------------------------
def test_streaming_request_body_is_compressed(monkeypatch, recorder):
    _no_proxies(monkeypatch)
    _mark_qumge(monkeypatch, recorder.url)

    provider = OpenAIProvider(base_url=recorder.url + "/v1", api_key="x")
    chunks = list(provider.stream(model="m", messages=[{"role": "user", "content": "hi"}]))

    # 最后一个分片带汇总 turn；文本拼起来是 "hi"
    final = chunks[-1].turn
    assert final is not None and final.text == "hi"
    assert len(recorder.records) == 1
    rec = recorder.records[0]
    assert rec["content_encoding"] == "gzip"
    body = json.loads(gzip.decompress(rec["raw_body"]))
    assert body["stream"] is True  # 确实是流式请求
    assert body["messages"] == [{"role": "user", "content": "hi"}]


# -- (e) 走 HTTP 代理：到达上游 stub 的仍是 gzip ----------------------------------------
def test_compressed_even_through_a_proxy(monkeypatch, recorder, forward_proxy):
    _no_proxies(monkeypatch)
    _mark_qumge(monkeypatch, recorder.url)
    # 只留自己那个转发代理；http:// 目标走它。DefaultHttpxClient trust_env=True 会读到。
    monkeypatch.setenv("http_proxy", forward_proxy.url)

    provider = OpenAIProvider(base_url=recorder.url + "/v1", api_key="x")
    turn = provider.complete(model="m", messages=[{"role": "user", "content": "hi"}])

    assert turn.text == "hello"  # 经代理转发后 SDK 仍正常解析
    # 请求确实经过了代理
    assert len(forward_proxy.records) == 1
    # 断言【到达上游 stub】的是 gzip —— 事件钩子在选 transport 之前跑，代理没绕过它
    assert len(recorder.records) == 1
    rec = recorder.records[0]
    assert rec["content_encoding"] == "gzip"
    assert json.loads(gzip.decompress(rec["raw_body"]))["model"] == "m"
