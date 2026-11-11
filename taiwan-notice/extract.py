# Takes the text out of the attachments of a Taiwanese firing notice.
#
#   extract.py DIR            every DIR/<fileId>.bin gets a DIR/<fileId>.json
#   extract.py DIR --lists    scanned ones also get their coordinate lists
#
# The .json is an attachment as readNotice (notice.mjs) takes it:
#
#   {format, pages: [text of each page]}                       real text
#   {format, pages, ocr: true, otherReadings: [[...]],         a scan
#    coordinateLists?: [...]}
#
# A PDF with almost no text is a scan and is read by character recognition
# (tesseract, Traditional Chinese and English), twice:
#
#   1. the page as it is, as one block of text. A page that comes out with
#      almost no Chinese is tried in the other three orientations.
#   2. the red channel only, which drops red seal impressions, with automatic
#      column layout.
#
# With --lists each list of corners is also cut out of the page at 400 dpi and
# read line by line, once as it is and three times with long straight strokes
# erased: an outline watermark and the sketch map often run through the list.
#
# The text names contact persons. It is written to DIR only, and DIR is a
# temporary directory of the caller.
import glob, io, json, os, re, statistics, subprocess, sys, tempfile, unicodedata, zipfile

MAX_PAGES = 60
MAX_PAGE_CHARS = 60000
MAX_TEXT_CHARS = 120000
SCAN_BELOW_CHARS = 200
OCR = ['-l', 'chi_tra+eng']
ERASE_LINES_FROM_PX = (None, 140, 100, 70)  # None: the list as it is
ANGLE = re.compile(r'\d{2,3}\s?[°º˚*]\s?\d{1,2}')


def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def page_images(pdf, directory, *options):
    run('pdftoppm', '-l', str(MAX_PAGES), *options, '-png', pdf, directory + '/p')
    number = lambda png: int(re.search(r'-(\d+)\.png$', png).group(1))
    return sorted(glob.glob(directory + '/p-*.png'), key=number)


def typed_text(data):
    """Format and pages of an attachment, as far as it holds real text."""
    if data[:5] == b'%PDF-':
        from pypdf import PdfReader

        pages = []
        for page in PdfReader(io.BytesIO(data)).pages[:MAX_PAGES]:
            try:
                text = page.extract_text(extraction_mode='layout') or ''
            except Exception:
                try:
                    text = page.extract_text() or ''
                except Exception:
                    text = ''
            pages.append(text[:MAX_PAGE_CHARS])
        return 'pdf', pages
    if data[:2] == b'PK':
        archive = zipfile.ZipFile(io.BytesIO(data))
        member = next((m for m in ('content.xml', 'word/document.xml') if m in archive.namelist()), None)
        if not member:
            return 'zip', []
        xml = archive.read(member).decode('utf8', 'replace')
        xml = re.sub(r'</(text:p|text:h|w:p|table:table-row|w:tr)>', '\n', xml)
        xml = re.sub(r'<(text:tab|w:tab)[^>]*/>', '\t', xml)
        return ('odt' if member == 'content.xml' else 'docx'), [re.sub(r'<[^>]+>', '', xml)[:MAX_TEXT_CHARS]]
    if data[:8] == bytes.fromhex('d0cf11e0a1b11ae1'):
        with tempfile.NamedTemporaryFile(suffix='.doc') as doc:
            doc.write(data)
            doc.flush()
            text = subprocess.run(['catdoc', '-w', doc.name], capture_output=True, timeout=30).stdout
        return 'ole', [text.decode('utf8', 'replace')[:MAX_TEXT_CHARS]]
    return 'other', []


def is_scan(kind, pages):
    return kind == 'pdf' and len(unicodedata.normalize('NFKC', ''.join(pages)).strip()) < SCAN_BELOW_CHARS


def chinese(text):
    return len(re.findall(r'[一-鿿]', text))


def read_scan(pdf):
    """Both readings of every page, and how far each page had to be turned."""
    first, second, turned = [], [], []
    with tempfile.TemporaryDirectory() as work:
        for png in page_images(pdf, work, '-scale-to', '3508'):
            text, turn = run('tesseract', png, 'stdout', *OCR, '--psm', '6'), 0
            if chinese(text) < 40:
                for degrees in (90, 180, 270):
                    rotated = f'{png[:-4]}-{degrees}.png'
                    run('convert', png, '-rotate', str(degrees), rotated)
                    other = run('tesseract', rotated, 'stdout', *OCR, '--psm', '6')
                    if chinese(other) > chinese(text):
                        text, turn = other, degrees
            red = png[:-4] + '-red.png'
            run('convert', png, '-channel', 'R', '-separate', *(['-rotate', str(turn)] if turn else []), red)
            first.append(text)
            second.append(run('tesseract', red, 'stdout', *OCR, '--psm', '4'))
            turned.append(turn)
    return first, second, turned


def without_long_strokes(gray, min_length):
    import cv2, numpy

    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    lines = cv2.HoughLinesP(ink, 1, numpy.pi / 360, threshold=min_length // 2, minLineLength=min_length, maxLineGap=6)
    for x1, y1, x2, y2 in lines.reshape(-1, 4) if lines is not None else []:
        cv2.line(ink, (int(x1), int(y1)), (int(x2), int(y2)), 0, 5)
    return 255 - ink


def read_lines(image, work):
    """Lines of text with the height of their middle and where their angles lie."""
    import cv2

    png = work + '/read.png'
    cv2.imwrite(png, image)
    lines = {}
    for row in run('tesseract', png, 'stdout', '-l', 'eng', '--psm', '6', 'tsv').split('\n')[1:]:
        cell = row.split('\t')
        if len(cell) < 12 or cell[0] != '5' or not cell[11].strip():
            continue
        left, top, width, height = map(int, cell[6:10])
        line = lines.setdefault(tuple(cell[2:5]), {'words': [], 'tops': [], 'bottoms': [], 'angles': []})
        line['words'].append(cell[11])
        line['tops'].append(top)
        line['bottoms'].append(top + height)
        if ANGLE.search(cell[11]):
            line['angles'] += [left, left + width]
    return [
        {
            'text': ' '.join(line['words']),
            'y': (statistics.median(line['tops']) + statistics.median(line['bottoms'])) / 2,
            'height': statistics.median(b - t for t, b in zip(line['tops'], line['bottoms'])),
            'angles': line['angles'],
        }
        for line in lines.values()
    ]


def coordinate_blocks(lines, shape):
    """Boxes around runs of at least three neighbouring lines that carry an angle."""
    with_angle = sorted((line for line in lines if line['angles']), key=lambda line: line['y'])
    if len(with_angle) < 3:
        return []
    pitch = statistics.median(line['height'] for line in with_angle) * 1.6
    runs, current = [], [with_angle[0]]
    for line in with_angle[1:]:
        if line['y'] - current[-1]['y'] > 3 * pitch:
            runs.append(current)
            current = []
        current.append(line)
    runs.append(current)
    boxes = []
    for lines_of_run in runs:
        if len(lines_of_run) < 3:
            continue
        # Often only the longitudes were recognised; the label and the
        # latitude lie to the left of them.
        x0 = min(min(line['angles']) for line in lines_of_run) - 8 * pitch
        x1 = max(max(line['angles']) for line in lines_of_run) + 2 * pitch
        y0 = lines_of_run[0]['y'] - 3 * pitch
        y1 = lines_of_run[-1]['y'] + 6 * pitch
        boxes.append([max(0, int(x0)), max(0, int(y0)), min(shape[1], int(x1)), min(shape[0], int(y1))])
    return boxes


def aligned(readings):
    """The readings of one block as lists of equal length: one entry per line of the block."""
    every = sorted((line['y'], line['height']) for lines in readings for line in lines)
    if not every:
        return [[] for _ in readings]
    gap = statistics.median(height for _, height in every) * 0.6
    slots = [[every[0][0]]]
    for y, _ in every[1:]:
        if y - slots[-1][-1] > gap:
            slots.append([])
        slots[-1].append(y)
    middles = [statistics.median(slot) for slot in slots]
    out = []
    for lines in readings:
        texts = [''] * len(middles)
        for line in sorted(lines, key=lambda line: line['y']):
            nearest = min(range(len(middles)), key=lambda i: abs(middles[i] - line['y']))
            texts[nearest] = (texts[nearest] + ' ' + line['text']).strip()
        out.append(texts)
    return out


def read_coordinate_lists(pdf, turned):
    import cv2

    rotate = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    lists = []
    with tempfile.TemporaryDirectory() as work:
        for index, png in enumerate(page_images(pdf, work, '-scale-to', '4678', '-gray')):
            gray = cv2.imread(png, cv2.IMREAD_GRAYSCALE)
            if turned[index]:
                gray = cv2.rotate(gray, rotate[turned[index]])
            for x0, y0, x1, y1 in coordinate_blocks(read_lines(gray, work), gray.shape):
                cut = gray[y0:y1, x0:x1]
                lists.append(
                    aligned(
                        [
                            read_lines(cut if length is None else without_long_strokes(cut, length), work)
                            for length in ERASE_LINES_FROM_PX
                        ]
                    )
                )
    return lists


def extract(path, with_lists):
    out = path[:-4] + '.json'
    known = json.load(open(out, encoding='utf8')) if os.path.exists(out) else None
    if known is None:
        kind, pages = typed_text(open(path, 'rb').read())
        known = {'format': kind, 'pages': pages}
        if is_scan(kind, pages):
            first, second, turned = read_scan(path)
            known = {'format': kind, 'pages': first, 'ocr': True, 'otherReadings': [second], 'turned': turned}
    if with_lists and known.get('ocr') and 'coordinateLists' not in known:
        known['coordinateLists'] = read_coordinate_lists(path, known['turned'])
    json.dump(known, open(out, 'w', encoding='utf8'), ensure_ascii=False)


if __name__ == '__main__':
    directory, with_lists = sys.argv[1], '--lists' in sys.argv[2:]
    for path in sorted(glob.glob(directory + '/*.bin')):
        try:
            extract(path, with_lists)
        except Exception as error:
            # One unreadable file must not hide the others; it reads as no text.
            print(f'{os.path.basename(path)}: {type(error).__name__}', file=sys.stderr)
            if not os.path.exists(path[:-4] + '.json'):
                json.dump({'format': 'error', 'pages': []}, open(path[:-4] + '.json', 'w'))
