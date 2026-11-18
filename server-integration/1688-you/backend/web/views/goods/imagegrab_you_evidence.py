"""Read-only recovery of saved card text; clues never become verified attributes."""
import re
import unicodedata


def normalized(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or ''))).strip().lower()


def valid_brand(value):
    return normalized(value) not in {'', 'other', 'others', '其他', '其它', '其他品牌', '其它品牌', '无', '无品牌',
        '未知', '未标注', '不详', '通用', 'oem', 'odm', 'n/a', 'none', 'null', '品牌未识别', '品牌'}


def recover_card(raw):
    result = dict(raw)
    fields = dict(raw.get('fieldEvidence') or {})
    body = re.sub(r'\s+', ' ', str(raw.get('visibleText') or '')).strip()
    title = str(raw.get('title') or '')
    if title and body.startswith(title):
        body = body[len(title):].strip()
    price = re.search(r'[¥￥]\s*\d+(?:,\d{3})*(?:\s*\.\s*\d+)?(?:\s*[-~至]\s*[¥￥]?\s*\d+(?:,\d{3})*(?:\s*\.\s*\d+)?)?', body)
    sales = re.search(r'(?:已售\s*[\d,.]+\s*(?:万|千|K|M)?\+?\s*件|成交\s*[\d,.]+\s*(?:笔|件)|[\d,.]+(?:万|千)?\+?\s*(?:人付款|人已付款|笔成交|件成交|件已售|人收货))', body, re.I)
    seller = re.search(r'(?:^|\s)([^\s¥￥<>]{3,80}(?:工厂|公司|旗舰店|专营店|专卖店|商行|批发部|经营部|店|厂))$', body)
    values = {'priceText': re.sub(r'\s+', '', price[0]) if price else '',
              'salesText': sales[0] if sales else '', 'supplierName': seller[1] if seller else ''}
    for key, value in values.items():
        if not result.get(key) and value:
            result[key] = value
            fields[key] = {'source': '搜索页保存文本', 'status': 'recorded', 'value': value}
    result['fieldEvidence'] = fields
    return result


def brand_evidence(raw, criteria):
    target = str(criteria.get('brand') or '').strip()
    details = raw.get('details') if isinstance(raw.get('details'), dict) else {}
    values = [{'value': str(a.get('value') or ''), 'source': '详情属性：' + str(a.get('name') or '')}
              for a in details.get('attributes', []) if isinstance(a, dict)
              and re.fullmatch(r'(?:商品)?品牌(?:名称)?(?:\([^)]*\))?', normalized(a.get('name')))]
    if raw.get('brand'):
        values.append({'value': str(raw['brand']), 'source': '采集品牌字段'})
    valid = [v for v in values if valid_brand(v['value'])]
    result = {'relation': 'unknown', 'values': valid, 'target': target}
    if not valid_brand(target):
        return dict(result, reason='未提供可核对的目标品牌')
    brands = {normalized(v['value']) for v in valid}
    expected = normalized(target)
    abbreviated = any(min(len(b), len(expected)) >= 2 and (b.startswith(expected) or expected.startswith(b)) for b in brands)
    if brands:
        relation = 'same' if brands == {expected} else 'different' if expected not in brands and not abbreviated else 'unknown'
        reason = '明确品牌字段：' + ' / '.join(v['value'] for v in valid) + '；目标品牌：' + target
        if relation == 'unknown':
            reason += '；可能存在简称差异，待核对' if expected not in brands and abbreviated else '；页面品牌字段互相冲突，待人工核对'
        return dict(result, relation=relation, reason=reason)
    title = str(raw.get('title') or details.get('title') or '')
    match = re.match(r'^[\u4e00-\u9fffA-Za-z0-9·&]{2,20}(?:照明|灯具|电器|家居|科技|服饰|母婴|美妆)', title)
    clue = str(raw.get('brandClue') or (match[0] if match else ''))
    if not clue and expected in normalized(title):
        clue = target
    if clue:
        value = normalized(clue)
        abbreviated = min(len(value), len(expected)) >= 2 and (value.startswith(expected) or expected.startswith(value))
        relation = 'same' if value == expected else 'unknown' if abbreviated else 'different'
        label = {'same': '疑似同品牌', 'different': '疑似不同品牌', 'unknown': '可能存在简称差异'}[relation]
        return dict(result, clue=clue, clueRelation=relation,
                    reason=f'标题品牌线索：{clue}；目标品牌：{target}；{label}，待详情核验')
    return dict(result, reason=f'目标品牌：{target}；候选品牌尚未采到，待详情补全')
