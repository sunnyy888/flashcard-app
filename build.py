"""Inline cards.js into app_template.html -> index.html (the single-file app). Run: python3 build.py"""
import os
H = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(H, "app_template.html")).read()
cards = open(os.path.join(H, "cards.js")).read()
assert "/*CARDS*/" in tpl
open(os.path.join(H, "index.html"), "w").write(tpl.replace("/*CARDS*/", cards))
print("built index.html (%d KB)" % (os.path.getsize(os.path.join(H, "index.html")) // 1024))
