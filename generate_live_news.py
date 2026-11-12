#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FLUX News Live Real-Time News Data Generator
Pulls real-time news across major Korean publishers and outputs news-data.json
"""

import urllib.request
import xml.etree.ElementTree as ET
import re
import html
import json
import datetime
from email.utils import parsedate_to_datetime

FEEDS = [
    # 주요 헤드라인 (Headlines)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER', 'SBS', 'headlines', '주요 헤드라인', '속보·종합'),
    ('https://rss.donga.com/total.xml', '동아일보', 'headlines', '주요 헤드라인', '헤드라인'),
    ('https://www.hani.co.kr/rss/', '한겨레', 'headlines', '주요 헤드라인', '이슈종합'),
    ('https://www.khan.co.kr/rss/rssdata/total_news.xml', '경향신문', 'headlines', '주요 헤드라인', '헤드라인'),
    ('https://www.hankyung.com/feed/all-news', '한국경제', 'headlines', '주요 헤드라인', '실시간속보'),

    # 정치·사회 (Politics & Society)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER', 'SBS', 'politics', '정치·사회', '국회·정당'),
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=04&plink=RSSREADER', 'SBS', 'politics', '정치·사회', '사회·사건'),
    ('https://rss.donga.com/politics.xml', '동아일보', 'politics', '정치·사회', '정치일반'),
    ('https://rss.donga.com/national.xml', '동아일보', 'politics', '정치·사회', '사회·법조'),
    ('https://www.hani.co.kr/rss/politics/', '한겨레', 'politics', '정치·사회', '정치·행정'),
    ('https://www.hani.co.kr/rss/society/', '한겨레', 'politics', '정치·사회', '사회·노동'),
    ('https://www.khan.co.kr/rss/rssdata/politic_news.xml', '경향신문', 'politics', '정치·사회', '정치'),

    # 경제·금융 (Economy & Finance)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER', 'SBS', 'economy', '경제·금융', '거시·금융'),
    ('https://rss.donga.com/economy.xml', '동아일보', 'economy', '경제·금융', '산업·재계'),
    ('https://www.hani.co.kr/rss/economy/', '한겨레', 'economy', '경제·금융', '경제·부동산'),
    ('https://www.khan.co.kr/rss/rssdata/economy_news.xml', '경향신문', 'economy', '경제·금융', '금융·증시'),
    ('https://www.hankyung.com/feed/economy', '한국경제', 'economy', '경제·금융', '경제일반'),
    ('https://www.hankyung.com/feed/finance', '한국경제', 'economy', '경제·금융', '증시·투자'),

    # IT·AI·과학 (Tech, AI, Science)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=07&plink=RSSREADER', 'SBS', 'tech', 'IT·AI·과학', 'IT·과학'),
    ('https://www.khan.co.kr/rss/rssdata/it_news.xml', '경향신문', 'tech', 'IT·AI·과학', '모바일·SW'),
    ('https://www.hankyung.com/feed/it', '한국경제', 'tech', 'IT·AI·과학', '반도체·AI'),

    # 스포츠 (Sports)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=09&plink=RSSREADER', 'SBS', 'sports', '스포츠', '스포츠종합'),
    ('https://rss.donga.com/sports.xml', '동아일보', 'sports', '스포츠', '축구·야구'),

    # 연예·문화 (Entertainment)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=08&plink=RSSREADER', 'SBS', 'entertainment', '연예·문화', '방송·연예'),
    ('https://rss.donga.com/entertainment.xml', '동아일보', 'entertainment', '연예·문화', '영화·음악'),

    # 세계·외신 (World)
    ('https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=05&plink=RSSREADER', 'SBS', 'world', '세계·외신', '국제종합'),
    ('https://rss.donga.com/international.xml', '동아일보', 'world', '세계·외신', '미국·글로벌'),
    ('https://www.hani.co.kr/rss/international/', '한겨레', 'world', '세계·외신', '외신분석'),
]

FALLBACK_IMAGES = {
    'headlines': [
        'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80'
    ],
    'politics': [
        'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?auto=format&fit=crop&w=1200&q=80'
    ],
    'economy': [
        'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80'
    ],
    'tech': [
        'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80'
    ],
    'sports': [
        'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80'
    ],
    'entertainment': [
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80'
    ],
    'world': [
        'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1200&q=80'
    ]
}

def clean_html(raw_html):
    if not raw_html:
        return ''
    cleanr = re.compile(r'<.*?>')
    cleantext = re.sub(cleanr, '', raw_html)
    return html.unescape(cleantext).strip()

def format_relative_time(pub_date_str):
    if not pub_date_str:
        return '최신 뉴스'
    try:
        dt = parsedate_to_datetime(pub_date_str)
        now = datetime.datetime.now(dt.tzinfo)
        diff = now - dt
        seconds = diff.total_seconds()
        if seconds < 0:
            return '방금 전'
        if seconds < 3600:
            minutes = max(1, int(seconds // 60))
            return f'{minutes}분 전'
        elif seconds < 86400:
            hours = int(seconds // 3600)
            return f'{hours}시간 전'
        else:
            days = int(seconds // 86400)
            return f'{days}일 전'
    except Exception:
        return '오늘 실시간'

def run():
    now_kst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    print(f'Starting live news pull at {now_kst.isoformat()}...')
    
    articles = []
    seen_titles = set()
    img_counter = {}

    for url, publisher, cat_key, cat_name, sub_cat in FEEDS:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        try:
            res = urllib.request.urlopen(req, timeout=5)
            raw = res.read()
            root = ET.fromstring(raw)
            feed_count = 0
            
            for item in root.findall('.//item'):
                title = clean_html(item.find('title').text if item.find('title') is not None else '')
                if not title or len(title) < 5 or title in seen_titles:
                    continue
                seen_titles.add(title)
                
                raw_desc = item.find('description').text if item.find('description') is not None else ''
                desc = clean_html(raw_desc)
                link = (item.find('link').text or '').strip() if item.find('link') is not None else ''
                pub_date = (item.find('pubDate').text or '').strip() if item.find('pubDate') is not None else ''
                time_str = format_relative_time(pub_date)
                
                # Image extraction
                img = ''
                encl = item.find('enclosure')
                if encl is not None and 'image' in encl.attrib.get('type', ''):
                    img = encl.attrib.get('url', '')
                if not img and raw_desc:
                    m = re.search(r'src=[\"\'](https?://[^\"\']+\.(?:jpg|jpeg|png|webp))', raw_desc)
                    if m:
                        img = m.group(1)
                
                if not img:
                    fallbacks = FALLBACK_IMAGES.get(cat_key, FALLBACK_IMAGES['headlines'])
                    idx = img_counter.get(cat_key, 0) % len(fallbacks)
                    img = fallbacks[idx]
                    img_counter[cat_key] = img_counter.get(cat_key, 0) + 1

                # Summary & body paragraphs
                summary = desc if desc else title
                if len(summary) > 180:
                    summary = summary[:180] + '...'
                
                # Generate clean paragraphs for reader
                body_paras = []
                if desc and len(desc) > 80:
                    parts = [p.strip() for p in re.split(r'\.\s+', desc) if p.strip()]
                    chunk = []
                    for p in parts:
                        chunk.append(p + '.')
                        if len(' '.join(chunk)) > 100:
                            body_paras.append(' '.join(chunk))
                            chunk = []
                    if chunk:
                        body_paras.append(' '.join(chunk))
                if not body_paras:
                    body_paras = [
                        summary,
                        f'본 기사는 {publisher}에서 실시간으로 보도된 공식 기사입니다. 세부적인 현장 보도와 전체 내용은 상단의 원문 기사 바로가기를 통해 확인하실 수 있습니다.'
                    ]

                art_id = f'flux-live-{len(articles) + 1}'
                is_breaking = (cat_key == 'headlines' and feed_count < 3)

                articles.append({
                    'id': art_id,
                    'category': cat_key,
                    'categoryName': cat_name,
                    'subCategory': sub_cat,
                    'title': title,
                    'publisher': publisher,
                    'time': time_str,
                    'pubDate': pub_date,
                    'image': img,
                    'caption': f'{publisher} 실시간 보도 사진',
                    'isBreaking': is_breaking,
                    'summary': summary,
                    'body': body_paras,
                    'link': link,
                    'relatedMedia': []
                })

                feed_count += 1
                if feed_count >= 10:
                    break

        except Exception as e:
            print(f'Warning: failed to fetch {publisher} ({url}): {e}')

    # Populate cross-media related media where titles share words
    for idx, art in enumerate(articles):
        words = [w for w in re.findall(r'[가-힣A-Za-z0-9]{2,}', art['title']) if w not in ('속보', '종합', '단독', '오늘', '내일', '사진', '영상')]
        if words:
            key_word = words[0]
            related = []
            for other in articles:
                if other['id'] != art['id'] and other['publisher'] != art['publisher'] and key_word in other['title']:
                    related.append({'pub': other['publisher'], 'title': other['title'], 'link': other.get('link', '')})
                    if len(related) >= 3:
                        break
            art['relatedMedia'] = related

    payload = {
        'updatedAt': now_kst.isoformat(),
        'updatedAtDisplay': now_kst.strftime('%m월 %d일 %H:%M KST'),
        'count': len(articles),
        'articles': articles
    }

    with open('news-data.json', 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f'Successfully generated news-data.json with {len(articles)} real live articles!')

if __name__ == '__main__':
    run()
