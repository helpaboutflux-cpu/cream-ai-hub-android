import asyncio, json, os, subprocess, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "..", "kite-motion", "shots")
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


async def main():
    srv = subprocess.Popen(["python3", "-m", "http.server", "8839", "--bind", "127.0.0.1"],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    rep = {}
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--disable-gpu", "--enable-unsafe-swiftshader"])
            ctx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
            page = await ctx.new_page()
            logs = []
            page.on("pageerror", lambda e: logs.append("pageerror: " + str(e)[:250]))
            await page.goto("http://127.0.0.1:8839/motion.html", wait_until="load")
            await page.wait_for_selector("#btnExport")
            await page.wait_for_timeout(500)

            # first MediaRecorder construction fails → the exporter must fall through to the next candidate
            rep["hooked"] = await page.evaluate("""() => {
              const MR = window.MediaRecorder;
              let n = 0;
              function Fake(stream, opts) {
                n++;
                if (n === 1) throw new DOMException('simulated unsupported codec', 'NotSupportedError');
                return new MR(stream, opts);
              }
              Fake.isTypeSupported = MR.isTypeSupported.bind(MR);
              window.__mrCalls = () => n;
              window.MediaRecorder = Fake;
              return true;
            }""")

            async with page.expect_download(timeout=90000) as d:
                await page.evaluate("document.getElementById('btnExport').click()")
                await page.wait_for_timeout(1500)
                rep["label_during"] = await page.evaluate("document.getElementById('exportLabel').textContent")
                rep["note_during"] = await page.evaluate("document.getElementById('exportNote').textContent")
            dl = await d.value
            path = os.path.join(OUT, "lemon-motion-retry.webm")
            await dl.save_as(path)
            await page.wait_for_timeout(500)
            rep["mr_calls"] = await page.evaluate("window.__mrCalls()")
            rep["label_after"] = await page.evaluate("document.getElementById('exportLabel').textContent")
            rep["probe"] = probe(path)
            rep["errors"] = [l for l in logs if l.startswith("pageerror")]
            await b.close()
    finally:
        srv.terminate()
    print(json.dumps(rep, ensure_ascii=False, indent=1))


asyncio.run(main())
