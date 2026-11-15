#!/usr/bin/env python3
"""Lemon Prompt 를 허브(index.html)에 멱등하게 등록한다.

- 단독 서비스 그리드에 다음 번호 카드 삽입
- 'N대 독립 웹 프로덕트' 카운트 갱신
- 푸터 상호 링크 추가
이미 등록되어 있으면 아무것도 하지 않는다(리베이스 후 재실행 안전).
"""
import re, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "index.html"
html = open(PATH, encoding="utf-8").read()

if 'href="prompt.html"' in html:
    print("already registered")
    sys.exit(0)

nums = [int(n) for n in re.findall(r"<!-- Service (\d+):", html)]
if not nums:
    print("service comments not found"); sys.exit(1)
last = max(nums)
new_no = last + 1

CARD = """        <!-- Service __NO__: Lemon Prompt -->
        <a href="prompt.html" class="card-hover-lift p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col justify-between space-y-3 hover:border-neutral-400 dark:hover:border-neutral-600 transition group">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/70 text-violet-600 dark:text-violet-400 font-semibold border border-violet-200 dark:border-violet-800/60">변수 템플릿 스튜디오</span>
              <span class="text-xs text-neutral-400 group-hover:translate-x-1 transition-transform">\u2192</span>
            </div>
            <h3 class="font-bold text-base text-neutral-900 dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">Lemon Prompt</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              프롬프트에 {"{{"}주제{"}}"} 같은 변수를 적어 두면 입력 폼이 자동으로 생기고, 값을 채우는 즉시 완성본이 조합됩니다. 20종 실전 프리셋, 카테고리\u00b7태그\u00b7버전 비교, 원클릭 복사와 #view= 공유 링크, IndexedDB 보관과 JSON 백업까지.
            </p>
          </div>
        </a>
""".replace("__NO__", str(new_no))

# 마지막 번호 카드 블록 뒤에 삽입
marker = "<!-- Service %d:" % last
i = html.index(marker)
end = html.index("</a>", i) + len("</a>")
html = html[:end] + "\n\n" + CARD.rstrip("\n") + html[end:]

# 카운트
html = re.sub(r"\d+대 독립 웹 프로덕트", "%d대 독립 웹 프로덕트" % new_no, html, count=1)

# 푸터 링크
fstart = html.index("<footer")
fend = html.index("</footer>", fstart)
foot = html[fstart:fend]
links = list(re.finditer(r'<a href="[^"]+\.html"[^>]*>[^<]*</a>', foot))
if links:
    last_link = links[-1]
    add = '\n        <span>\u00b7</span>\n        <a href="prompt.html" class="hover:underline text-violet-600 dark:text-violet-400 font-bold">Lemon Prompt</a>'
    foot = foot[:last_link.end()] + add + foot[last_link.end():]
    html = html[:fstart] + foot + html[fend:]

open(PATH, "w", encoding="utf-8").write(html)
print("registered as Service %d / %d대" % (new_no, new_no))
