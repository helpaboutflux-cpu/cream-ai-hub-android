import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), "kite-motion", "shots")
FF = "/workspace/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux"


def probe(path):
    r = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True, text=True)
    o = {"bytes": os.path.getsize(path)}
    for line in r.stderr.splitlines():
        s = line.strip()
        if s.startswith("Duration:"):
            o["duration"] = s.split("Duration:")[1].split(",")[0].strip()
        if "Stream #" in s:
            o.setdefault("streams", []).append(s.split("Stream #")[1][:70].strip())
    return o


async def run_case(page, tag, ratio):
    if ratio != "16:9":
        await page.click(f"#ratioSeg button[data-ratio='{ratio}']")
        await page.wait_for_timeout(300)
    await page.evaluate("document.getElementById('btnExport').scrollIntoView({block:'center'})")
    await page.wait_for_timeout(250)
    async with page.expect_download(timeout=90000) as d:
        await page.evaluate("document.getElementById('btnExport').click()")
        await page.wait_for_timeout(2500)
        mid = await page.evaluate("({lbl:document.getElementById('exportLabel').textContent, pct:document.getElementById('exportPct').textContent})")
    dl = await d.value
    p = os.path.join(OUT, f"lemon-{tag}.webm")
    await dl.save_as(p)
    await page.wait_for_timeout(600)
    ui = await page.evaluate("""() => {
      const a = document.getElementById('exportLink');
      const r = a.getBoundingClientRect();
      return {label: document.getElementById('exportLabel').textContent,
              linkShown: !document.getElementById('exportActions').hidden,
              href: (a.href||'').slice(0,20), download: a.download,
              text: a.textContent.trim(), box:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
              overflow: document.documentElement.scrollWidth - window.innerWidth};
    }""")
    out = {"ratio": ratio, "mid": mid, "name": dl.suggested_filename, "ui": ui, "probe": probe(p)}
    if ui["linkShown"]:
        try:
            async with page.expect_download(timeout=20000) as d2:
                await page.click("#exportLink", force=True)
            d2v = await d2.value
            p2 = os.path.join(OUT, f"lemon-{tag}-manual.webm")
            await d2v.save_as(p2)
            out["manual"] = {"name": d2v.suggested_filename, "probe": probe(p2)}
        except Exception as e:
            out["manual"] = {"error": str(e)[:160]}
    return out


async def main():
    srv = subprocess.Popen(["python3", "-m", "http.server", "8833", "--bind", "127.0.0.1"],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    rep = {}
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--disable-gpu", "--enable-unsafe-swiftshader"])
            ctx = await b.new_context(viewport={"width": 390, "height": 900}, is_mobile=True, has_touch=True,
                                      device_scale_factor=2.75, accept_downloads=True,
                                      user_agent="Mozilla/5.0 (Linux; Android 15; SM-A366B) AppleWebKit/537.36 "
                                                 "(KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36")
            page = await ctx.new_page()
            logs = []
            page.on("console", lambda m: logs.append(m.type + ": " + m.text[:150]))
            page.on("pageerror", lambda e: logs.append("pageerror: " + str(e)[:250]))
            await page.goto("http://127.0.0.1:8833/motion.html", wait_until="load")
            await page.wait_for_selector("#btnExport", timeout=20000)
            await page.wait_for_timeout(900)
            rep["patcher"] = await page.evaluate("!!(window.KM_WEBM && window.KM_WEBM.fix)")
            rep["mimes"] = await page.evaluate("""() => {
              const c=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
              const o={}; c.forEach(m=>o[m]=MediaRecorder.isTypeSupported(m)); return o;}""")
            rep["kite_16_9"] = await run_case(page, "kite169", "16:9")
            rep["prompt_9_16"] = await run_case(page, "prompt916", "9:16")
            await page.screenshot(path=os.path.join(OUT, "lemon-motion-done.png"))
            rep["errors"] = [l for l in logs if l.startswith(("error", "pageerror"))]
            await b.close()
    finally:
        srv.terminate()
    print(json.dumps(rep, ensure_ascii=False, indent=1))


asyncio.run(main())
