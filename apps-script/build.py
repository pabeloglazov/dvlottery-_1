"""Сборка админки и скрипта.

- apps-script/Code.gs      = intake.gs + admin-server.gs + admin.html (вставляется в Apps Script)
- public/admin/index.html  = admin.html для сайта: вход по коду на почту, запросы к веб-приложению
"""
import pathlib
here = pathlib.Path(__file__).parent
API_URL = "https://script.google.com/macros/s/AKfycbyP97pqQquagl_uw_c40G2gRXsAsREoSKClzGZ4jB5ogkDe0pFtFWEKDeAGBlBxq5w5Xg/exec"

html = (here / "admin.html").read_text(encoding="utf-8")
assert "`" not in html and "${" not in html, "admin.html не должен содержать ` или ${"
code = (here / "intake.gs").read_text(encoding="utf-8").rstrip() + "\n\n" + \
       (here / "admin-server.gs").read_text(encoding="utf-8").rstrip() + "\n\n" + \
       "const ADMIN_HTML = String.raw`" + html + "`;\n"
(here / "Code.gs").write_text(code, encoding="utf-8")

site = html.replace(
    '<head><meta charset="utf-8">',
    '<head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="robots" content="noindex, nofollow">\n<title>Заявки DV Lottery — админка</title>\n'
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 32 32\'%3E%3Crect width=\'32\' height=\'32\' rx=\'7\' fill=\'%23142140\'/%3E%3Ctext x=\'16\' y=\'21\' font-family=\'Arial\' font-weight=\'800\' font-size=\'12\' fill=\'white\' text-anchor=\'middle\'%3EGC%3C/text%3E%3C/svg%3E">', 1)
site = site.replace("<script>", '<script>window.ADMIN_API_URL = "' + API_URL + '";</script>\n<script>', 1)
out = here.parent / "public" / "admin" / "index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(site, encoding="utf-8")
print("Code.gs:", len(code), "| public/admin/index.html:", len(site))
