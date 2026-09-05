"""Unpaid, bounded watchlist extraction trial; no AI or benchmark-seeded crawling."""
import argparse
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class Page(HTMLParser):
    def __init__(self, html, url):
        super().__init__(convert_charrefs=True)
        self.url, self.text, self.links, self.structured = url, [], [], []
        self.hidden = 0
        self.ld = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'script' and attrs.get('type', '').lower() == 'application/ld+json':
            self.ld = []
        if tag == 'a' and attrs.get('href'):
            self.links.append(urljoin(self.url, attrs['href']).split('#')[0])

    def handle_endtag(self, tag):
        if tag == 'script' and self.ld is not None:
            try:
                self.structured.append(json.loads(''.join(self.ld)))
            except ValueError:
                pass
            self.ld = None
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if self.ld is not None:
            self.ld.append(data)
        elif not self.hidden and data.strip():
            self.text.append(data.strip())


def events(value):
    if isinstance(value, dict):
        types = value.get('@type', [])
        if isinstance(types, str):
            types = [types]
        if any(t == 'Event' or t.endswith('Event') for t in types):
            yield value
        for child in value.values():
            yield from events(child)
    elif isinstance(value, list):
        for child in value:
            yield from events(child)


def fetch(url):
    try:
        with urlopen(Request(url, headers={'User-Agent': 'EindhovenEventWatchTrial/1.0'}), timeout=20) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Page exceeds 2 MB trial limit')
            html = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            page = Page(html, response.url)
            text = ' '.join(page.text)
            extracted = [event for obj in page.structured for event in events(obj)]
            return {'requestedUrl': url, 'url': response.url, 'bytes': len(raw),
                    'hash': hashlib.sha256((text + json.dumps(page.structured, sort_keys=True)).encode()).hexdigest(),
                    'events': extracted, 'links': list(dict.fromkeys(page.links)),
                    'snippets': [text[max(0, match.start()-160):match.end()+240] for match in re.finditer(r'\b2027\b', text)][:30]}
    except Exception as error:
        return {'requestedUrl': url, 'error': str(error)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', action='append', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    # Sources come exclusively from stored discovery. Fixture is read after all fetching.
    sources = {}
    for filename in args.state:
        for lead in json.loads(Path(filename).read_text(encoding='utf-8'))['leads']:
            url = lead.get('url')
            if url and urlsplit(url).scheme in ('http', 'https'):
                sources.setdefault(url, lead['title'])
    urls = list(sources)[:24]
    with ThreadPoolExecutor(max_workers=6) as pool:
        first = list(pool.map(fetch, urls))
        follow = []
        for page in first:
            if 'error' in page:
                continue
            host = urlsplit(page['url']).hostname
            links = [link for link in page['links'] if urlsplit(link).hostname == host and link not in urls and link not in follow]
            # One observed internal link per source; year first, then future/about/calendar/news.
            ranked = sorted(links, key=lambda link: (-bool(re.search(r'2027|future|toekomst', link, re.I)), -bool(re.search(r'about|over-|agenda|calendar|kalender|nieuws|news', link, re.I))))
            if ranked and re.search(r'2027|future|toekomst|about|over-|agenda|calendar|kalender|nieuws|news', ranked[0], re.I):
                follow.append(ranked[0])
        pages = first + list(pool.map(fetch, follow))
        # Refetch the same URLs once to measure unchanged content, no AI in either pass.
        refreshed = list(pool.map(fetch, [page['requestedUrl'] for page in pages]))
    candidates = [{'page': page['url'], **event} for page in pages if 'error' not in page for event in page['events']
                  if str(event.get('startDate', '')).startswith('2027')]
    fixture = json.loads(Path('tests/fixtures/eindhoven-long-range-benchmark.json').read_text(encoding='utf-8'))
    normalize = lambda text: re.sub(r'[^a-z0-9]', '', text.lower())
    comparisons = []
    for expected in fixture['events']:
        names = [normalize(name) for name in [expected['title'], *expected.get('aliases', [])]]
        matches = [event for event in candidates if any(name in normalize(str(event.get('name', ''))) for name in names)]
        dates = [event for event in matches if str(event.get('startDate', ''))[:10] == expected['start'] and str(event.get('endDate', ''))[:10] == expected['end']]
        comparisons.append({'title': expected['title'], 'exactStructuredDates': bool(dates), 'matches': matches})
    result = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'Warm watchlist only; sources from prior paid discovery; structured output is not hotel scoring or validated official evidence.',
              'sourceFiles': args.state, 'sourceCount': len(urls), 'deferredSources': max(0, len(sources)-24),
              'firstPassRequests': len(pages), 'refreshRequests': len(refreshed),
              'firstPassFailures': sum('error' in page for page in pages),
              'unchangedOnRefresh': sum('hash' in old and old.get('hash') == new.get('hash') for old, new in zip(pages, refreshed)),
              'refreshFailures': sum('error' in page for page in refreshed),
              'aiRequests': 0, 'collectorApiCostUsd': 0, 'candidates': candidates,
              'comparisons': comparisons, 'pages': pages}
    Path(args.output).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in ('pages', 'candidates')}, indent=2))


if __name__ == '__main__':
    main()
