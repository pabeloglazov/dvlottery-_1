"""Собирает Code.gs для Apps Script: intake.gs + admin-server.gs + admin.html."""
import pathlib
here = pathlib.Path(__file__).parent
html = (here / "admin.html").read_text(encoding="utf-8")
assert "`" not in html and "${" not in html, "admin.html не должен содержать ` или ${"
out = (here / "intake.gs").read_text(encoding="utf-8").rstrip() + "\n\n" + \
      (here / "admin-server.gs").read_text(encoding="utf-8").rstrip() + "\n\n" + \
      "const ADMIN_HTML = String.raw`" + html + "`;\n"
(here / "Code.gs").write_text(out, encoding="utf-8")
print("Code.gs:", len(out), "chars")
