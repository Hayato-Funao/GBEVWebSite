"""
SharePoint REST API ヘルパー（Node.js の子プロセスとして呼び出す）
使い方: python sp_helper.py <command> [arg_json]

コマンド:
  get_token           - アクセストークンを返す（デバイスコードフロー含む）
  get_items           - リストアイテム一覧を返す
  add_item <json>     - アイテムを追加する
  update_item <id> <json> - アイテムを更新する
  delete_item <id>    - アイテムを削除する
  get_action_item <id> - 事務局アクションリストの単一行を返す（改修(第12回)）

戻り値: stdout に JSON
デバイスコードのメッセージ: stderr に出力
"""
import sys
import json
import os
import ctypes
import base64
import socket
import ssl
import time
import http.client
from urllib.parse import urlparse, urlencode

_HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE   = os.path.join(_HERE, 'token_cache.bin')

# 改修: プロキシがCONNECT要求を高確率で強制切断する不安定挙動があるため、
#       トンネル確立(CONNECT+TLS)を再試行する際の設定（.envで上書き可）
_PROXY_CONNECT_RETRY = int(os.environ.get('PROXY_CONNECT_RETRY', '8'))  # 最大試行回数
_PROXY_RETRY_WAIT    = float(os.environ.get('PROXY_RETRY_WAIT', '0.4'))  # 試行間隔（秒）

# .env を自動読み込み（環境変数が未設定の場合のみ）
_env_path = os.path.join(_HERE, '..', '.env')
if os.path.exists(_env_path):
    with open(_env_path, encoding='utf-8') as _f:
        for _line in _f:
            _m = __import__('re').match(r'^([^#=\s][^=]*)=(.*)', _line)
            if _m:
                _k, _v = _m.group(1).strip(), _m.group(2).strip()
                if not os.environ.get(_k):
                    os.environ[_k] = _v

CLIENT_ID    = 'd3590ed6-52b3-4102-aeff-aad2292ab01c'
AUTHORITY    = 'https://login.microsoftonline.com/organizations'
SITE_URL     = os.environ.get('SITE_URL', '').rstrip('/')
SP_LIST_PATH = os.environ.get('SP_LIST_PATH', '')
PROXY_URL    = os.environ.get('PROXY_URL', '')
# 改修(第13回): GUID方式でリストを参照（URL名依存を排除）
SP_LIST_GUID    = os.environ.get('SP_LIST_GUID', '')    # 統合HILS使用履歴リスト
SP_ACTION_GUID  = os.environ.get('SP_ACTION_GUID', '')  # 事務局アクションリスト

# ── Windows SSPI NTLM プロキシ認証 ───────────────────────────────────────────

_sec = ctypes.WinDLL('secur32.dll')
_advapi32 = ctypes.WinDLL('advapi32.dll')

class _SecHandle(ctypes.Structure):
    _fields_ = [('dwLower', ctypes.c_uint64), ('dwUpper', ctypes.c_uint64)]

class _TimeStamp(ctypes.Structure):
    _fields_ = [('LowPart', ctypes.c_uint32), ('HighPart', ctypes.c_int32)]

class _SecBuffer(ctypes.Structure):
    _fields_ = [('cbBuffer', ctypes.c_ulong), ('BufferType', ctypes.c_ulong), ('pvBuffer', ctypes.c_void_p)]

class _SecBufferDesc(ctypes.Structure):
    _fields_ = [('ulVersion', ctypes.c_ulong), ('cBuffers', ctypes.c_ulong), ('pBuffers', ctypes.POINTER(_SecBuffer))]

_SECPKG_CRED_OUTBOUND  = 2
_ISC_FLAGS = 0x4 | 0x8 | 0x10 | 0x800   # REPLAY_DETECT|SEQUENCE_DETECT|CONFIDENTIALITY|CONNECTION
_SECURITY_NATIVE_DREP  = 0x10
_SEC_I_CONTINUE_NEEDED = 0x00090312
_SECBUFFER_TOKEN       = 2

# 改修(バッチログオン対応): タスクスケジューラの「ログオン有無に関わらず実行」セッションでは、
#   暗黙の現在ユーザー資格情報によるNTLM SSOがプロキシに407で拒否される事象を確認した。
#   Windows資格情報マネージャー（cmdkeyで事前登録）に明示的な資格情報があれば、それを使って
#   NTLM認証する。無ければ従来通り暗黙の資格情報（現在ログインユーザー）にフォールバックする。
_PROXY_CRED_TARGET = 'HILS_PROXY_AUTH'
_SEC_WINNT_AUTH_IDENTITY_UNICODE = 0x2
_CRED_TYPE_GENERIC = 1

class _CredFiletime(ctypes.Structure):
    _fields_ = [('dwLowDateTime', ctypes.c_uint32), ('dwHighDateTime', ctypes.c_uint32)]

class _CREDENTIAL(ctypes.Structure):
    pass
_CREDENTIAL._fields_ = [
    ('Flags', ctypes.c_uint32),
    ('Type', ctypes.c_uint32),
    ('TargetName', ctypes.c_wchar_p),
    ('Comment', ctypes.c_wchar_p),
    ('LastWritten', _CredFiletime),
    ('CredentialBlobSize', ctypes.c_uint32),
    ('CredentialBlob', ctypes.POINTER(ctypes.c_byte)),
    ('Persist', ctypes.c_uint32),
    ('AttributeCount', ctypes.c_uint32),
    ('Attributes', ctypes.c_void_p),
    ('TargetAlias', ctypes.c_wchar_p),
    ('UserName', ctypes.c_wchar_p),
]

class _SEC_WINNT_AUTH_IDENTITY_W(ctypes.Structure):
    _fields_ = [
        ('User', ctypes.c_wchar_p),
        ('UserLength', ctypes.c_uint32),
        ('Domain', ctypes.c_wchar_p),
        ('DomainLength', ctypes.c_uint32),
        ('Password', ctypes.c_wchar_p),
        ('PasswordLength', ctypes.c_uint32),
        ('Flags', ctypes.c_uint32),
    ]


def _read_stored_credential(target_name):
    """Windows資格情報マネージャーのGenericクレデンシャルを読み取る。無ければNoneを返す。"""
    p_cred = ctypes.POINTER(_CREDENTIAL)()
    ok = _advapi32.CredReadW(ctypes.c_wchar_p(target_name), _CRED_TYPE_GENERIC, 0, ctypes.byref(p_cred))
    if not ok:
        return None
    try:
        cred = p_cred.contents
        username = cred.UserName or ''
        blob_size = cred.CredentialBlobSize
        if blob_size and cred.CredentialBlob:
            raw = bytes(bytearray(cred.CredentialBlob[i] & 0xFF for i in range(blob_size)))
            password = raw.decode('utf-16-le', errors='ignore')
        else:
            password = ''
        return username, password
    finally:
        _advapi32.CredFree(p_cred)


def _build_auth_identity():
    """cmdkeyで登録済みの明示的資格情報からSEC_WINNT_AUTH_IDENTITY_Wを構築する。"""
    stored = _read_stored_credential(_PROXY_CRED_TARGET)
    if not stored:
        return None
    username, password = stored
    if '\\' in username:
        domain, user = username.split('\\', 1)
    else:
        domain, user = '', username
    # ctypesが文字列バッファを保持し続けるよう、モジュール変数として参照を維持する
    identity = _SEC_WINNT_AUTH_IDENTITY_W(
        User=user, UserLength=len(user),
        Domain=domain, DomainLength=len(domain),
        Password=password, PasswordLength=len(password),
        Flags=_SEC_WINNT_AUTH_IDENTITY_UNICODE,
    )
    return identity


def _ntlm_connect(proxy_host, proxy_port, target_host, target_port):
    """Windows SSPI を使って NTLM 認証付き CONNECT トンネルを確立し、socket を返す。"""

    # 資格情報ハンドル取得。資格情報マネージャーに明示登録があれば優先し、
    # 無ければ現在のWindowsログインユーザーの暗黙の資格情報を使う。
    identity = _build_auth_identity()
    p_auth_data = ctypes.byref(identity) if identity is not None else None

    h_cred = _SecHandle()
    ts = _TimeStamp()
    if _sec.AcquireCredentialsHandleW(
            None, "NTLM", _SECPKG_CRED_OUTBOUND, None, p_auth_data, None, None,
            ctypes.byref(h_cred), ctypes.byref(ts)) != 0:
        raise RuntimeError("AcquireCredentialsHandle 失敗")

    # NTLM Type 1 (Negotiate) 生成
    buf1 = ctypes.create_string_buffer(4096)
    sec1 = _SecBuffer(cbBuffer=4096, BufferType=_SECBUFFER_TOKEN, pvBuffer=ctypes.cast(buf1, ctypes.c_void_p))
    desc1 = _SecBufferDesc(ulVersion=0, cBuffers=1, pBuffers=ctypes.pointer(sec1))
    h_ctxt = _SecHandle()
    attrs = ctypes.c_ulong(0)
    ts2 = _TimeStamp()
    _sec.InitializeSecurityContextW(
        ctypes.byref(h_cred), None, f"HTTP/{target_host}",
        _ISC_FLAGS, 0, _SECURITY_NATIVE_DREP, None, 0,
        ctypes.byref(h_ctxt), ctypes.byref(desc1), ctypes.byref(attrs), ctypes.byref(ts2))
    type1_b64 = base64.b64encode(bytes(buf1[:sec1.cbBuffer])).decode()

    # プロキシに TCP 接続
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(30)
    sock.connect((proxy_host, proxy_port))

    # CONNECT + Type 1 送信
    req1 = (f"CONNECT {target_host}:{target_port} HTTP/1.1\r\n"
            f"Host: {target_host}:{target_port}\r\n"
            f"Proxy-Authorization: NTLM {type1_b64}\r\n"
            "Proxy-Connection: Keep-Alive\r\n\r\n")
    sock.sendall(req1.encode())

    # Type 2 (Challenge) 受信
    raw = b""
    while b"\r\n\r\n" not in raw:
        chunk = sock.recv(4096)
        if not chunk:
            break
        raw += chunk

    # 407 本文を読み飛ばし（raw に既にボディが含まれている場合を考慮）
    hdr_end = raw.index(b"\r\n\r\n")
    hdr_str = raw[:hdr_end].decode('latin-1')
    already_body = raw[hdr_end + 4:]
    cl = 0
    for line in hdr_str.split('\r\n'):
        if line.lower().startswith('content-length:'):
            cl = int(line.split(':',1)[1].strip())
    remaining = max(0, cl - len(already_body))
    if remaining > 0:
        body_read = b""
        while len(body_read) < remaining:
            chunk = sock.recv(remaining - len(body_read))
            if not chunk:
                break
            body_read += chunk

    type2_b64 = None
    for line in hdr_str.split('\r\n'):
        if line.lower().startswith('proxy-authenticate: ntlm '):
            type2_b64 = line.split(' ', 2)[2].strip()
            break
    if not type2_b64:
        sock.close()
        raise RuntimeError(f"NTLM Type 2 チャレンジなし。プロキシ応答:\n{hdr_str[:300]}")

    # NTLM Type 3 (Authenticate) 生成
    type2 = base64.b64decode(type2_b64)
    in_mem = ctypes.create_string_buffer(type2)
    in_sec = _SecBuffer(cbBuffer=len(type2), BufferType=_SECBUFFER_TOKEN, pvBuffer=ctypes.cast(in_mem, ctypes.c_void_p))
    in_desc = _SecBufferDesc(ulVersion=0, cBuffers=1, pBuffers=ctypes.pointer(in_sec))
    buf3 = ctypes.create_string_buffer(4096)
    sec3 = _SecBuffer(cbBuffer=4096, BufferType=_SECBUFFER_TOKEN, pvBuffer=ctypes.cast(buf3, ctypes.c_void_p))
    desc3 = _SecBufferDesc(ulVersion=0, cBuffers=1, pBuffers=ctypes.pointer(sec3))
    h_ctxt2 = _SecHandle()
    st3 = _sec.InitializeSecurityContextW(
        ctypes.byref(h_cred), ctypes.byref(h_ctxt), f"HTTP/{target_host}",
        _ISC_FLAGS, 0, _SECURITY_NATIVE_DREP, ctypes.byref(in_desc), 0,
        ctypes.byref(h_ctxt2), ctypes.byref(desc3), ctypes.byref(attrs), ctypes.byref(ts2))
    if st3 not in (0, _SEC_I_CONTINUE_NEEDED):
        sock.close()
        raise RuntimeError(f"InitializeSecurityContext (Type 3) 失敗: {st3:#010x}")
    type3_b64 = base64.b64encode(bytes(buf3[:sec3.cbBuffer])).decode()

    # Type 3 送信（同じ接続上）
    req2 = (f"CONNECT {target_host}:{target_port} HTTP/1.1\r\n"
            f"Host: {target_host}:{target_port}\r\n"
            f"Proxy-Authorization: NTLM {type3_b64}\r\n"
            "Proxy-Connection: Keep-Alive\r\n\r\n")
    sock.sendall(req2.encode())

    raw2 = b""
    while b"\r\n\r\n" not in raw2:
        chunk = sock.recv(4096)
        if not chunk:
            break
        raw2 += chunk

    if b"200" not in raw2[:30]:
        sock.close()
        raise RuntimeError(f"CONNECT 失敗: {raw2[:200].decode('latin-1')}")

    return sock


def _parsed_proxy():
    """PROXY_URL から (host, port) を返す。プロキシなしなら None。"""
    if not PROXY_URL:
        return None
    p = urlparse(PROXY_URL)
    return (p.hostname, p.port or 8080)


# ── NTLM 対応 HTTP クライアント ──────────────────────────────────────────────

class _Response:
    """requests.Response 互換の最小実装"""
    def __init__(self, status_code, headers, body_bytes):
        self.status_code = status_code
        self.headers = {k.lower(): v for k, v in headers}
        self._body = body_bytes

    @property
    def text(self):
        return self._body.decode('utf-8', errors='replace')

    def json(self):
        return json.loads(self._body)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}: {self.text[:200]}")


class _NtlmHTTPSConnection(http.client.HTTPSConnection):
    """NTLM プロキシ越しに確立済みの SSL ソケットを使う HTTPSConnection"""
    def __init__(self, host, port, established_sock, timeout=60):
        super().__init__(host, port, timeout=timeout)
        self._established_sock = established_sock

    def connect(self):
        self.sock = self._established_sock


def _http_request(method, url, headers=None, data=None, params=None, timeout=60, **_kw):
    """NTLM プロキシ越しに HTTP/HTTPS リクエストを実行する。"""
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    path = parsed.path or '/'
    if params:
        path += '?' + urlencode(params)
    elif parsed.query:
        path += '?' + parsed.query

    proxy = _parsed_proxy()

    if proxy and parsed.scheme == 'https':
        # 改修: プロキシがCONNECTを高確率で強制切断する不安定挙動があるため、
        #       トンネル確立（CONNECT+TLS）を再接続込みでリトライする。
        #       切断は毎回アプリ要求送信前のCONNECT段階で発生するため、
        #       リトライしてもPOST等の二重実行は起きない。
        ssl_sock = None
        last_err = None
        for _attempt in range(_PROXY_CONNECT_RETRY):
            try:
                raw_sock = _ntlm_connect(proxy[0], proxy[1], host, port)
                ctx = ssl.create_default_context()
                ssl_sock = ctx.wrap_socket(raw_sock, server_hostname=host)
                break
            except (ConnectionResetError, ConnectionAbortedError, socket.timeout, ssl.SSLError, OSError) as e:
                last_err = e
                if _attempt < _PROXY_CONNECT_RETRY - 1:
                    time.sleep(_PROXY_RETRY_WAIT)
        if ssl_sock is None:
            raise RuntimeError(f"プロキシCONNECT確立失敗（{_PROXY_CONNECT_RETRY}回試行）: {last_err!r}")
        conn = _NtlmHTTPSConnection(host, port, ssl_sock, timeout=timeout)
    elif proxy and parsed.scheme == 'http':
        conn = http.client.HTTPConnection(proxy[0], proxy[1], timeout=timeout)
        path = url  # プロキシには絶対 URL を送る
    else:
        if parsed.scheme == 'https':
            conn = http.client.HTTPSConnection(host, port, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)

    req_headers = dict(headers or {})
    req_headers.setdefault('Connection', 'close')
    req_headers.setdefault('Host', host)

    body = None
    if data is not None:
        if isinstance(data, dict):
            # None 値は送信しない（requests と同じ挙動）
            filtered = {k: v for k, v in data.items() if v is not None}
            body = urlencode(filtered).encode()
            req_headers.setdefault('Content-Type', 'application/x-www-form-urlencoded')
        elif isinstance(data, str):
            body = data.encode('utf-8')
        else:
            body = data
        req_headers['Content-Length'] = str(len(body))

    conn.request(method, path, body=body, headers=req_headers)
    resp = conn.getresponse()
    body_bytes = resp.read()
    result = _Response(resp.status, resp.getheaders(), body_bytes)
    conn.close()
    return result


class _NtlmSession:
    """requests.Session 互換ラッパー（MSAL の http_client として渡す）"""
    proxies = {}
    verify   = True
    auth     = None

    def get(self, url, **kw):
        return _http_request('GET', url, **kw)

    def post(self, url, **kw):
        return _http_request('POST', url, **kw)

    def close(self):
        pass


# ── SharePoint セッション（Bearer トークン付き）────────────────────────────

def _sp_session(token):
    class _SpSession:
        def __init__(self):
            self._hdrs = {
                'Authorization': f'Bearer {token}',
                'Accept': 'application/json;odata=verbose',
                'Content-Type': 'application/json;odata=verbose',
            }

        def _req(self, method, url, extra_headers=None, **kw):
            h = dict(self._hdrs)
            if extra_headers:
                h.update(extra_headers)
            return _http_request(method, url, headers=h, **kw)

        def get(self, url, **kw):
            return self._req('GET', url, **kw)

        def post(self, url, extra_headers=None, json=None, **kw):
            if json is not None:
                import json as _j
                kw['data'] = _j.dumps(json).encode()
                hdrs = {'Content-Type': 'application/json;odata=verbose'}
                if extra_headers:
                    hdrs.update(extra_headers)
                extra_headers = hdrs
            return self._req('POST', url, extra_headers=extra_headers, **kw)

    return _SpSession()


# ── トークン取得 ─────────────────────────────────────────────────────────────

# 改修(第14回): scopes引数追加。既定=SP .defaultスコープ（従来どおり）。Graph用等は任意スコープを渡せる
def get_token(scopes=None, force=False):
    import msal

    parsed = urlparse(SITE_URL)
    if scopes is None:
        scopes = [f"{parsed.scheme}://{parsed.netloc}/.default"]

    cache = msal.SerializableTokenCache()
    # 改修(再サインイン): force=True時は既存キャッシュを読み込まない。
    #               旧アカウントのトークンを引き継がせず、必ずデバイスコード認証を発生させるため。
    if not force and os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r') as f:
            cache.deserialize(f.read())

    ntlm_session = _NtlmSession()
    app = msal.PublicClientApplication(
        CLIENT_ID, authority=AUTHORITY,
        token_cache=cache, http_client=ntlm_session
    )

    result = None
    # 改修(再サインイン): force=True時はacquire_token_silentをスキップし、必ずデバイスコードフローに進む
    if not force:
        accounts = app.get_accounts()
        if accounts:
            result = app.acquire_token_silent(scopes, account=accounts[0])
            if result and 'error' in result:
                result = None

    if not result:
        flow = app.initiate_device_flow(scopes=scopes)
        if 'user_code' not in flow:
            return {'error': 'デバイスコードフロー開始失敗: ' + flow.get('error_description', '')}
        print(flow['message'], file=sys.stderr, flush=True)
        result = app.acquire_token_by_device_flow(flow)

    if cache.has_state_changed:
        with open(CACHE_FILE, 'w') as f:
            f.write(cache.serialize())

    if 'access_token' in result:
        return {'token': result['access_token']}
    return {'error': result.get('error_description', '認証失敗')}


# ── SharePoint 操作 ──────────────────────────────────────────────────────────

def _make_sp_session():
    tok = get_token()
    if 'error' in tok:
        return None, tok['error']
    return _sp_session(tok['token']), None


# 改修(第13回): リストGUIDからAPIベースURLを生成するヘルパー（URL名依存を排除）
def _list_base_url(site_url, guid):
    return f"{site_url.rstrip('/')}/_api/web/lists(guid'{guid}')"


# 改修(第13回): GUIDを指定してエンティティ型名を取得する汎用版
def _get_entity_type_by_guid(sess, site_url, guid):
    url = f"{_list_base_url(site_url, guid)}?$select=ListItemEntityTypeFullName"
    r = sess.get(url)
    r.raise_for_status()
    return r.json()['d']['ListItemEntityTypeFullName']


def _get_entity_type(sess):
    # 改修(第13回): SP_LIST_GUIDが設定されていればGUID方式で取得
    if SP_LIST_GUID:
        return _get_entity_type_by_guid(sess, SITE_URL, SP_LIST_GUID)
    url = f"{SITE_URL}/_api/web/GetList('{SP_LIST_PATH}')?$select=ListItemEntityTypeFullName"
    r = sess.get(url)
    r.raise_for_status()
    return r.json()['d']['ListItemEntityTypeFullName']


# 改修(第13回): サイトURL・GUIDを指定してアイテムを追加する汎用ヘルパー
def _add_item(sess, site_url, guid, fields):
    etype = _get_entity_type_by_guid(sess, site_url, guid)
    body  = {'__metadata': {'type': etype}, **fields}
    url   = f"{_list_base_url(site_url, guid)}/items"
    r = sess.post(url, json=body)
    r.raise_for_status()
    return r.json()['d']


# 改修(第13回): サイトURL・GUIDを指定してアイテムを更新する汎用ヘルパー
def _update_item(sess, site_url, guid, item_id, fields):
    etype = _get_entity_type_by_guid(sess, site_url, guid)
    body  = {'__metadata': {'type': etype}, **fields}
    url   = f"{_list_base_url(site_url, guid)}/items({item_id})"
    r = sess.post(url, json=body, extra_headers={'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'})
    r.raise_for_status()


# ── メイン ──────────────────────────────────────────────────────────────────

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'get_token'

    if cmd == 'get_token':
        print(json.dumps(get_token(), ensure_ascii=False))
        return

    # 改修(再サインイン): 既存キャッシュを無視して強制的にデバイスコード認証を行い、
    #               token_cache.bin を新しい認証情報で上書きする（パスワード変更後・担当者交代用）。
    #               SP操作は不要なためsess生成前に処理する（send_mailと同様の位置づけ）。
    if cmd == 'resignin':
        tok = get_token(force=True)
        if 'error' in tok:
            print(json.dumps({'error': tok['error']}, ensure_ascii=False))
        else:
            print(json.dumps({'resignin': 'success'}, ensure_ascii=False))
        return

    # 改修(第14回): Graph API /me/sendMail で委任トークンによりメール送信（SP不要のためsess生成前に処理）
    # 改修: 宛先(to)・CC(cc)ともカンマ区切りで複数アドレスに対応。宛先/CCはNode側のコンソール設定
    # （backend/mail_config.json）に基づき呼び出し元(server.js/hils_alert.py)が決定して渡す
    if cmd == 'send_mail':
        to      = sys.argv[2]
        subject = sys.argv[3]
        body    = sys.argv[4]
        cc      = sys.argv[5] if len(sys.argv) > 5 else ''
        # Mail.Send スコープでトークン取得（委任フロー。サインインユーザー自身として送信）
        tok = get_token(['https://graph.microsoft.com/Mail.Send'])
        if 'error' in tok:
            print(json.dumps({'error': tok['error']}, ensure_ascii=False))
            return
        # Graph API sendMail エンドポイント（/me/sendMail = サインインユーザー名義で送信）
        url = 'https://graph.microsoft.com/v1.0/me/sendMail'
        # カンマ区切りの複数アドレスをGraph API形式（emailAddressオブジェクトの配列）へ変換
        to_addresses = [a.strip() for a in to.split(',') if a.strip()]
        payload = {
            'message': {
                'subject': subject,
                'body': {'contentType': 'Text', 'content': body},
                'toRecipients': [{'emailAddress': {'address': a}} for a in to_addresses],
            }
        }
        if cc:
            cc_addresses = [a.strip() for a in cc.split(',') if a.strip()]
            if cc_addresses:
                payload['message']['ccRecipients'] = [{'emailAddress': {'address': a}} for a in cc_addresses]
        h = {
            'Authorization': f"Bearer {tok['token']}",
            'Content-Type':  'application/json',
        }
        r = _http_request('POST', url, headers=h, data=json.dumps(payload).encode())
        r.raise_for_status()  # sendMail 成功時は HTTP 202
        print(json.dumps({'success': True}))
        return

    sess, err = _make_sp_session()
    if err:
        print(json.dumps({'error': err}, ensure_ascii=False))
        return

    try:
        if cmd == 'get_items':
            # 改修(第13回): SP_LIST_GUIDが設定されていればGUID方式で取得
            if SP_LIST_GUID:
                url = f"{_list_base_url(SITE_URL, SP_LIST_GUID)}/items?$top=5000"
            else:
                url = f"{SITE_URL}/_api/web/GetList('{SP_LIST_PATH}')/items?$top=5000"
            r = sess.get(url)
            r.raise_for_status()
            print(json.dumps({'items': r.json()['d']['results']}, ensure_ascii=False))

        elif cmd == 'add_item':
            fields = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
            # 改修(第13回): SP_LIST_GUIDが設定されていればGUID方式で追加
            if SP_LIST_GUID:
                item = _add_item(sess, SITE_URL, SP_LIST_GUID, fields)
                print(json.dumps({'item': item}, ensure_ascii=False))
            else:
                etype = _get_entity_type(sess)
                body  = {'__metadata': {'type': etype}, **fields}
                url   = f"{SITE_URL}/_api/web/GetList('{SP_LIST_PATH}')/items"
                r = sess.post(url, json=body)
                r.raise_for_status()
                print(json.dumps({'item': r.json()['d']}, ensure_ascii=False))

        elif cmd == 'update_item':
            item_id = sys.argv[2]
            fields  = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
            # 改修(第13回): SP_LIST_GUIDが設定されていればGUID方式で更新
            if SP_LIST_GUID:
                _update_item(sess, SITE_URL, SP_LIST_GUID, item_id, fields)
            else:
                etype = _get_entity_type(sess)
                body  = {'__metadata': {'type': etype}, **fields}
                url   = f"{SITE_URL}/_api/web/GetList('{SP_LIST_PATH}')/items({item_id})"
                r = sess.post(url, json=body, extra_headers={'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'})
                r.raise_for_status()
            print(json.dumps({'ok': True}))

        elif cmd == 'delete_item':
            item_id = sys.argv[2]
            # 改修(第13回): SP_LIST_GUIDが設定されていればGUID方式で削除
            if SP_LIST_GUID:
                etype = _get_entity_type_by_guid(sess, SITE_URL, SP_LIST_GUID)
                url   = f"{_list_base_url(SITE_URL, SP_LIST_GUID)}/items({item_id})"
            else:
                etype = _get_entity_type(sess)
                url   = f"{SITE_URL}/_api/web/GetList('{SP_LIST_PATH}')/items({item_id})"
            body = {'__metadata': {'type': etype}}
            r = sess.post(url, json=body, extra_headers={'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE'})
            r.raise_for_status()
            print(json.dumps({'ok': True}))

        # 改修(第12回): 事務局アクションリスト（別サイト jphgt110776）の単一行取得
        # 改修(第13回): URL名依存を排除し、SP_ACTION_GUIDによるGUID参照に切替
        # 改修: URLのidはTitle列の値。Title一致でフィルタして先頭行を返す
        elif cmd == 'get_action_item':
            id_or_title = sys.argv[2]
            action_site = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid = os.environ.get('SP_ACTION_GUID', '')
            if action_guid:
                base_url = _list_base_url(action_site, action_guid)
            else:
                # フォールバック: GUIDが未設定の場合は旧パス方式
                list_path = os.environ.get('SP_ACTION_LIST', SP_LIST_PATH)
                base_url = f"{action_site}/_api/web/GetList('{list_path}')"
            # 改修: 予約管理表列が[$ID]で起動するため数値ならID直接取得、非数値はTitleフィルタ（最新行優先）
            if id_or_title.isdigit():
                r = sess.get(f"{base_url}/items({id_or_title})")
                r.raise_for_status()
                print(json.dumps(r.json()['d'], ensure_ascii=False))
            else:
                safe_title = id_or_title.replace("'", "''")  # ODataシングルクォートのエスケープ
                r = sess.get(f"{base_url}/items", params={
                    '$filter':  f"Title eq '{safe_title}'",
                    '$top':     '1',
                    '$orderby': 'Id desc',  # 重複Title時は最新行を優先
                })
                r.raise_for_status()
                results = r.json()['d']['results']
                print(json.dumps(results[0] if results else {}, ensure_ascii=False))

        # 改修(第13回): リスト列定義を取得する診断コマンド（内部名・型の実機確認用）
        # 引数: reservation（予約リスト）or action（事務局アクションリスト）
        elif cmd == 'get_fields':
            target = sys.argv[2] if len(sys.argv) > 2 else 'reservation'
            if target == 'action':
                target_site = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
                target_guid = os.environ.get('SP_ACTION_GUID', '')
            else:
                target_site = SITE_URL
                target_guid = SP_LIST_GUID
            if not target_guid:
                print(json.dumps({'error': f'{target} の GUID が未設定'}, ensure_ascii=False))
            else:
                # 改修: クエリパラメータはparamsに分離してURLエンコードを適用
                url = f"{_list_base_url(target_site, target_guid)}/fields"
                r = sess.get(url, params={
                    '$select':  'Title,InternalName,TypeAsString,Required,Hidden,ReadOnlyField',
                    '$filter':  'Hidden eq false and ReadOnlyField eq false',
                    '$orderby': 'Title',
                })
                r.raise_for_status()
                fields_raw = r.json()['d']['results']
                fields_out = [
                    {
                        '表示名': f['Title'],
                        '内部名': f['InternalName'],
                        '型':     f['TypeAsString'],
                        '必須':   f['Required'],
                    }
                    for f in fields_raw
                ]
                print(json.dumps({'fields': fields_out}, ensure_ascii=False, indent=2))

        # 改修(第13回): 事務局アクションリストのステータス列を更新（W-5登録時・W-12更新時）
        elif cmd == 'update_action_status':
            item_id      = sys.argv[2]
            status_value = sys.argv[3]
            action_site  = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid  = os.environ.get('SP_ACTION_GUID', '')
            if not action_guid:
                print(json.dumps({'error': 'SP_ACTION_GUID が未設定'}, ensure_ascii=False))
            else:
                # ステータス列: InternalName _x30b9__x30c6__x30fc__x30bf__x30（32文字切詰）→ OData__プレフィックス付き
                fields = {'OData__x30b9__x30c6__x30fc__x30bf__x30': status_value}
                _update_item(sess, action_site, action_guid, item_id, fields)
                print(json.dumps({'ok': True}))

        # 改修(第13回): 事務局アクションリストの状態列を更新（W-7）
        # 状態値: 通常 / 予備 / 故障 / 休日
        elif cmd == 'update_action_state':
            item_id     = sys.argv[2]
            state_value = sys.argv[3]
            action_site = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid = os.environ.get('SP_ACTION_GUID', '')
            if not action_guid:
                print(json.dumps({'error': 'SP_ACTION_GUID が未設定'}, ensure_ascii=False))
            else:
                # 状態列の内部名はget_fieldsで確認済みの値を使用
                fields = {'OData__x72b6__x614b_': state_value}
                _update_item(sess, action_site, action_guid, item_id, fields)
                print(json.dumps({'ok': True}))

        # 改修(第14回): 事務局アクションリストの承知/辞退列を更新（W-9）
        # accept_status: '承知' / '辞退' / '期間変更'。承知時はステータス変更しない（1.仮申請受領を維持）
        # 改修(不具合修正): 内部名を get_fields action で実機照合済み（32文字切詰後の正しい値に修正）。
        # 旧値は切詰前の35字名で存在しない列を指しており、SP側でInvalidClientQueryExceptionの原因だった
        elif cmd == 'update_action_accept':
            item_id       = sys.argv[2]
            accept_status = sys.argv[3]  # '承知' / '辞退' / '期間変更'
            action_site   = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid   = os.environ.get('SP_ACTION_GUID', '')
            if not action_guid:
                print(json.dumps({'error': 'SP_ACTION_GUID が未設定'}, ensure_ascii=False))
            else:
                # 承知/辞退/期間変更列（get_fields照合済の内部名）
                fields = {'OData__x627f__x77e5__x002f__x8f9e__x90': accept_status}
                _update_item(sess, action_site, action_guid, item_id, fields)
                print(json.dumps({'ok': True}))

        # 改修(第14回): 事務局アクションリストに期間変更申請データを記録（W-10）
        # ステータスを「9.期間変更申請中」に更新し、希望終了日・申請理由を書き込む
        # 改修(第15回): get_fields action で実内部名を照合済（下記fields参照）
        elif cmd == 'update_action_extend':
            item_id   = sys.argv[2]
            new_end   = sys.argv[3]  # 希望終了日（YYYY-MM-DD）
            reason    = sys.argv[4]  # 申請理由
            # new_start は現状SP側に開始日列を持たないため引数のみ受領（将来の列追加対応用）
            # new_start = sys.argv[5] if len(sys.argv) > 5 else ''
            action_site = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid = os.environ.get('SP_ACTION_GUID', '')
            if not action_guid:
                print(json.dumps({'error': 'SP_ACTION_GUID が未設定'}, ensure_ascii=False))
            else:
                # 改修(第15回): DateTime列は予約リスト（server.js toSpFields）同様ISO形式(T00:00:00Z)で渡す
                end_iso = (new_end.split('T')[0] + 'T00:00:00Z') if new_end else None
                fields = {
                    # 改修(第15回): 内部名は32文字切詰後の HILS_x5229__x7528__x7d42__x4e86_（末尾「日」が脱落）が正。
                    # 旧値は切詰前の39字名で存在しない列を指しており、SP側でInvalidClientQueryExceptionの原因だった
                    'HILS_x5229__x7528__x7d42__x4e86_':       end_iso,
                    'OData__x7533__x8acb__x7406__x7531_':     reason,             # 申請理由列（get_fields照合済）
                    'OData__x30b9__x30c6__x30fc__x30bf__x30': '9.期間変更申請中', # ステータス列（第13回検証済の32字名）
                }
                _update_item(sess, action_site, action_guid, item_id, fields)
                print(json.dumps({'ok': True}))

        # 改修: 事務局アクションリストに利用取消依頼の取消理由を記録する。
        # 期間変更申請（update_action_extend）と異なり、ステータス列は更新しない。
        # ステータス遷移は事務局が予約を削除したタイミングで別途 update_action_status が呼ばれる。
        elif cmd == 'update_action_cancel':
            item_id     = sys.argv[2]
            cancel_reason = sys.argv[3]  # 取消理由
            action_site = os.environ.get('SP_ACTION_SITE', SITE_URL).rstrip('/')
            action_guid = os.environ.get('SP_ACTION_GUID', '')
            if not action_guid:
                print(json.dumps({'error': 'SP_ACTION_GUID が未設定'}, ensure_ascii=False))
            else:
                # 取消理由列（内部名は申請理由列 OData__x7533__x8acb__x7406__x7531_ と同系。実機はget_fieldsで照合すること）
                fields = {'OData__x53d6__x6d88__x7406__x7531_': cancel_reason}
                _update_item(sess, action_site, action_guid, item_id, fields)
                print(json.dumps({'ok': True}))

        else:
            print(json.dumps({'error': f'不明なコマンド: {cmd}'}))

    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
