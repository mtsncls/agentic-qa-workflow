#!/usr/bin/env python3
"""Fix runaway Chart.js canvas height in dashboard/index.html (in place).
Usage: python3 patch_dashboard.py dashboard/index.html
Idempotent. Makes a .bak copy. Exits non-zero if an expected pattern is missing."""
import re, sys, shutil

path = sys.argv[1] if len(sys.argv) > 1 else "dashboard/index.html"
s = open(path, encoding="utf-8").read()
if 'class="chart-container"><canvas' in s and "applyChartDefaults" in s:
    print("Already patched."); sys.exit(0)
shutil.copy(path, path + ".bak")

def must(cond, msg):
    if not cond:
        print("ABORT:", msg); sys.exit(1)

# 1) CSS: drop the global canvas rule that creates the resize feedback loop
m = re.search(r"/\* Ensure charts respect[^\n]*\*/\s*canvas\s*\{[^}]*\}\s*", s)
if not m:
    m = re.search(r"\n\s*canvas\s*\{[^}]*!important[^}]*\}\s*", s)
must(m, "global `canvas { ... !important }` rule not found")
s = s[:m.start()] + "\n.chart-container canvas { display: block; }\n\n" + s[m.end():]

# 2) CSS: fixed-height wrapper
m = re.search(r"\.chart-container\s*\{[^}]*\}", s)
must(m, ".chart-container rule not found")
s = s[:m.start()] + ".chart-container {\n  position: relative;\n  height: 300px;\n  width: 100%;\n  min-width: 0;\n}" + s[m.end():]

# 3) CSS: grid that doesn't overflow on small screens
s = s.replace("minmax(600px, 1fr)", "minmax(min(100%, 420px), 1fr)")

# 4) HTML: wrap every chart canvas
n_before = len(re.findall(r'<canvas id="\w+"></canvas>', s))
must(n_before >= 6, f"expected 6 bare <canvas> tags, found {n_before}")
s = re.sub(r'<canvas id="(\w+)"></canvas>', r'<div class="chart-container"><canvas id="\1"></canvas></div>', s)

# 5) JS options: one consistent sizing mode
s = re.sub(r"\n[ \t]*maintainAspectRatio: true,", "", s)
s = re.sub(r"\n[ \t]*aspectRatio: [\d.]+,[^\n]*", "", s)

# 6) Tooltip bug on bar charts (dataset.label is undefined)
s = s.replace("${context.dataset.label}: ${context.raw}", "${context.label}: ${context.raw}")

# 7) Remove dead block that runs before charts exist
i = s.find("  // Ensure chart containers have strict")
if i != -1:
    j = s.find("</script>", i)
    s = s[:i].rstrip() + "\n" + s[j:]

# 8) Global Chart.js defaults (light axis text on dark bg, no resize loop)
must("function renderKpis(history) {" in s, "renderKpis not found")
s = s.replace("function renderKpis(history) {", """function applyChartDefaults() {
  const cs = getComputedStyle(document.documentElement);
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = false;
  Chart.defaults.color = cs.getPropertyValue('--text-secondary').trim() || '#94a3b8';
  Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.1)';
}

function renderKpis(history) {
  applyChartDefaults();""", 1)

open(path, "w", encoding="utf-8").write(s)
print("Patched", path, "(backup:", path + ".bak)")
