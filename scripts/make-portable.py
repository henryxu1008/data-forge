#!/usr/bin/env python3
"""将已有 Vite 构建转换为无需服务端的离线单文件 HTML（仅 Python 标准库）。"""

from __future__ import annotations

import argparse
import base64
import html
from html.parser import HTMLParser
import mimetypes
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "dist" / "client"
DEFAULT_OUTPUT = ROOT.parent / "output" / "创平数智工场-交互原型.html"
STATIC_ASSETS = [
    "/assets/brand-mark.png",
    *[f"/assets/fonts/noto-sc-{weight}.woff" for weight in (400, 500, 600, 700)],
]
CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data: blob:; font-src data:; connect-src 'none'; "
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
)


class PortableError(Exception):
    """输入构建无法安全转换为完全独立的离线页面。"""


class TagAttributes(HTMLParser):
    def __init__(self, tag: str):
        super().__init__(convert_charrefs=True)
        self.values = {}
        self.feed(tag)

    def handle_starttag(self, tag, attrs):
        self.values = dict(attrs)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)


class ResourceAudit(HTMLParser):
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in ("script", "img", "iframe", "audio", "video", "source"):
            source = values.get("src")
            if source and not source.startswith(("data:", "blob:")):
                raise PortableError(f"HTML 中仍含未内联的 src 资源：{source}")
        if values.get("srcset"):
            raise PortableError("HTML 中仍含未处理的 srcset 资源。")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)


def local_file(url: str, base: Path = CLIENT, allow_public: bool = False) -> Path:
    """拒绝远程 URL、路径越界；只读取本项目构建或 public 中的文件。"""
    parts = urlsplit(html.unescape(url))
    if parts.scheme or parts.netloc:
        raise PortableError(f"检测到外部资源，无法离线内联：{url}")
    name = unquote(parts.path)
    candidate = (CLIENT / name.lstrip("/") if name.startswith("/") else base / name).resolve()
    try:
        candidate.relative_to(CLIENT.resolve())
    except ValueError as exc:
        raise PortableError(f"资源路径超出 dist/client：{url}") from exc
    if candidate.is_file():
        return candidate
    if allow_public and name.startswith("/assets/"):
        source = (ROOT / "public" / name.lstrip("/")).resolve()
        try:
            source.relative_to((ROOT / "public").resolve())
        except ValueError as exc:
            raise PortableError(f"资源路径超出 public：{url}") from exc
        if source.is_file():
            return source
    raise PortableError(f"找不到资源：{url}；请先运行 npm run build。")


def data_url(path: Path) -> str:
    mime = {".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png"}.get(
        path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    )
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def escape_raw_close(text: str, tag: str) -> str:
    # HTML 的 script/style 原始文本即使位于 JS/CSS 字符串或注释内，也会识别结束标签。
    return re.sub(rf"</{tag}", lambda match: match.group(0).replace("/", r"\/", 1), text, flags=re.I)


def remove_preload_polyfill(script: str) -> str:
    # Vite 默认在 bundle 最前面添加 modulepreload IIFE。离线版没有外链模块，
    # 删除这一段可同时去掉无用的 MutationObserver 和 fetch；其余 JS 保持不变。
    stripped = script.lstrip()
    if stripped.startswith("(function(){"):
        end = stripped.find("})();")
        prefix = stripped[: end + 5] if end >= 0 else ""
        if 'supports("modulepreload")' in prefix and "MutationObserver" in prefix and "fetch(" in prefix:
            script = stripped[end + 5 :]
    return re.sub(r"(?m)^\s*//#\s*sourceMappingURL=.*$", "", script)


def license_text() -> str:
    sources = [
        ("Noto Sans SC / SIL Open Font License 1.1", "licenses/Noto-Sans-SC-OFL.txt", "node_modules/@fontsource/noto-sans-sc/LICENSE"),
        ("Tabler Icons / MIT License", "licenses/Tabler-Icons-MIT.txt", "node_modules/@tabler/icons-react/LICENSE"),
        ("React / MIT License", "licenses/React-MIT.txt", "node_modules/react/LICENSE"),
        ("React DOM / MIT License", "licenses/React-DOM-MIT.txt", "node_modules/react-dom/LICENSE"),
    ]
    notices = []
    for label, copied, original in sources:
        path = ROOT / copied
        if not path.is_file():
            path = ROOT / original
        if not path.is_file():
            raise PortableError(f"缺少随附许可文本：{copied}；请保留 licenses 目录或先安装依赖。")
        notices.append(label + "\n\n" + path.read_text(encoding="utf-8"))
    return "\n\n".join(notices)


def build_portable() -> str:
    index = CLIENT / "index.html"
    if not index.is_file():
        raise PortableError("找不到 dist/client/index.html；请先运行 npm run build。")
    source = index.read_text(encoding="utf-8")
    encoded = {url: data_url(local_file(url, allow_public=True)) for url in STATIC_ASSETS}

    def replace_assets(text: str) -> str:
        for url, encoded_url in encoded.items():
            text = text.replace(url, encoded_url)
        return text

    def inline_css(match: re.Match) -> str:
        attrs = TagAttributes(match.group(0)).values
        rels = (attrs.get("rel") or "").lower().split()
        if any(rel in rels for rel in ("modulepreload", "preload", "prefetch", "preconnect", "dns-prefetch")):
            return ""
        if "stylesheet" not in rels:
            if attrs.get("href"):
                raise PortableError(f"未处理的 link 外链：{attrs['href']}")
            return match.group(0)
        path = local_file(attrs.get("href") or "")
        css = replace_assets(path.read_text(encoding="utf-8"))
        css = re.sub(r"/\*[#@]\s*sourceMappingURL=.*?\*/", "", css, flags=re.S)
        if re.search(r"@import\b", css, flags=re.I):
            raise PortableError("CSS 仍含 @import；请在 Vite 构建中先合并样式。")

        def inline_url(url_match: re.Match) -> str:
            url = url_match.group(2).strip()
            if url.startswith(("data:", "#")):
                return url_match.group(0)
            return f'url("{data_url(local_file(url, base=path.parent))}")'

        css = re.sub(r"url\(\s*(['\"]?)(.*?)\1\s*\)", inline_url, css, flags=re.I)
        media = f' media="{html.escape(attrs["media"], quote=True)}"' if attrs.get("media") else ""
        return f"<style{media}>\n{escape_raw_close(css, 'style')}\n</style>"

    def inline_js(match: re.Match) -> str:
        attrs = TagAttributes(match.group(1)).values
        if attrs.get("src"):
            script = local_file(attrs["src"]).read_text(encoding="utf-8")
        else:
            script = match.group(2)
        script = replace_assets(remove_preload_polyfill(script))
        if re.search(r"\bimport(?:\s+[^;]*?\s+from\s*[\"']|\s*[\"'({*])", script):
            raise PortableError("JS 仍含外部模块 import；离线导出要求 Vite 将依赖合并到 bundle。")
        if re.search(r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(", script):
            raise PortableError("JS 仍含网络请求 API；当前导出仅支持完全本地的模拟原型。")
        if re.search(r"/assets/[^\s\"'`<>]+", script):
            raise PortableError("JS 仍含未内联的 /assets/ 资源，请在脚本中加入对应静态资源。")
        kind = attrs.get("type") or "module"
        if kind not in ("module", "text/javascript", "application/javascript"):
            raise PortableError(f"不支持的 script 类型：{kind}")
        return f'<script type="module">\n{escape_raw_close(script, "script")}\n</script>'

    source = re.sub(r"<link\b[^>]*>", inline_css, source, flags=re.I)
    source = re.sub(r"(<script\b[^>]*>)(.*?)</script\s*>", inline_js, source, flags=re.I | re.S)
    source = replace_assets(source)
    source = re.sub(r'<html\b[^>]*>', '<html lang="zh-CN">', source, count=1, flags=re.I)
    source = re.sub(r"<title>.*?</title>", "<title>创平数智工场 · 离线交互原型</title>", source, count=1, flags=re.I | re.S)
    policy = f'<meta http-equiv="Content-Security-Policy" content="{html.escape(CSP, quote=True)}">'
    source = re.sub(r"(<head\b[^>]*>)", lambda m: m.group(1) + "\n    " + policy, source, count=1, flags=re.I)
    notices = '<template id="third-party-licenses">\n' + html.escape(license_text()) + "\n</template>\n"
    source = re.sub(r"</body\s*>", lambda m: notices + m.group(0), source, count=1, flags=re.I)
    ResourceAudit(convert_charrefs=True).feed(source)
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_OUTPUT, help="输出 HTML 路径；默认为项目旁 output/创平数智工场-交互原型.html")
    args = parser.parse_args()
    try:
        document = build_portable()
        output = args.output.expanduser().resolve()
        if output == (CLIENT / "index.html").resolve():
            raise PortableError("输出路径不可覆盖构建输入 dist/client/index.html。")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(document, encoding="utf-8")
    except (PortableError, OSError, UnicodeError) as exc:
        print(f"离线导出失败：{exc}", file=sys.stderr)
        return 1
    print(f"离线 HTML 已写入：{output}\n大小：{output.stat().st_size / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
