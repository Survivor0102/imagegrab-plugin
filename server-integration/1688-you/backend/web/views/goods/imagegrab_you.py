"""Admin-only, incremental and idempotent ImageGrab synchronization."""
import hashlib
import json
import re
from urllib.parse import urlsplit

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Q
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from web.models.imagegrab_you import ImageGrabYouJob, ImageGrabYouOffer, ImageGrabYouProduct, ImageGrabYouRequest, ImageGrabYouCandidate
from web.views.goods.sourcing_candidates import is_admin
from web.views.goods.imagegrab_you_evidence import recover_card, brand_evidence


class ImageGrabAdmin(BasePermission):
    message = '需要管理员权限'

    def has_permission(self, request, view):
        return is_admin(request.user)


def text(value, limit=None):
    value = str(value or '').strip()
    if limit and len(value) > limit:
        raise ValidationError(f'字段长度超过 {limit}')
    return value


def array(value):
    return value if isinstance(value, list) else []


def obj(value):
    return value if isinstance(value, dict) else {}


def number(value, default, low=1, high=50000):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def safe_url(value):
    value = text(value)
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ('http', 'https') and parsed.hostname else ''
    except ValueError:
        return ''


def image_urls(values):
    return [url for item in array(values) if (url := safe_url(item))]


def source_key(item):
    url = safe_url(item.get('url'))
    match = re.search(r'/offer/(\d+)\.html', url)
    if match:
        return '1688:' + match[1], match[1]
    key = text(item.get('id') or item.get('offerId'), 160)
    if not key and url:
        key = hashlib.sha256(url.encode()).hexdigest()
    if not key:
        raise ValidationError('货源缺少稳定标识或有效链接')
    return key, text(item.get('offerId'), 64)


def offer_json(row):
    details = obj(row.details)
    media = [dict(item, url=safe_url(item.get('url'))) for item in array(details.get('media')) if isinstance(item, dict)]
    skus = [dict(item, imageUrl=safe_url(item.get('imageUrl'))) for item in array(details.get('skus')) if isinstance(item, dict)]
    return {
        'id': row.id, 'title': row.title, 'url': safe_url(row.url),
        'offer_id': row.offer_id, 'images': image_urls(row.images),
        'supplier_name': row.supplier_name, 'supplier_url': safe_url(row.supplier_url),
        'price_text': row.price_text, 'moq_text': row.moq_text, 'sales_text': row.sales_text,
        'ship_from': row.ship_from, 'customer_service': dict(obj(row.customer_service), url=safe_url(obj(row.customer_service).get('url'))),
        'detail_status': row.detail_status,
        'details': dict(details, media=media, skus=skus),
        'updated_at': row.updated_at.isoformat(),
    }


def product_json(row, details=False):
    data = {
        'id': row.id, 'title': row.title, 'brand': row.brand, 'category': row.category,
        'source_type': row.source_type, 'scope': row.scope,
        'source_url': safe_url(row.source_url), 'images': image_urls(row.images),
        'offer_count': getattr(row, 'offer_count', 0), 'updated_at': row.updated_at.isoformat(),
    }
    if details:
        data.update(certificates=row.certificates, specs=row.payload.get('specs', ''),
                    offers=[offer_json(offer) for offer in row.offers.all()])
    return data


def reference_json(value):
    value = obj(value)
    image = text(value.get('image') or value.get('original'))
    # Input images are previews, not executable SVG or arbitrary data URLs.
    if not re.fullmatch(r'data:image/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+', image):
        image = safe_url(image)
    if len(image) > 550000:
        raise ValidationError('寻源原图预览过大')
    return {'image': image, 'crop': value.get('crop')}


def request_json(row, details=False):
    related = [row.id] + list(row.searches.values_list('id', flat=True))
    links = ImageGrabYouCandidate.objects.filter(request_id__in=related).select_related('offer', 'offer__product', 'request').order_by('-updated_at', '-id')
    data = {'id': row.id, 'title': row.title, 'criteria': row.criteria,
            'reference': reference_json(row.reference), 'candidate_count': links.values('candidate_key').distinct().count(),
            'query_count': len(related), 'provenance': row.payload.get('provenance', ''), 'updated_at': row.updated_at.isoformat()}
    if details:
        grouped = {}
        # Prefer evidence captured for the actual target over a related, broader query.
        links = sorted(links, key=lambda link: link.request_id != row.id)
        for link in links:
            if link.candidate_key not in grouped:
                evidence = dict(obj(link.evidence))
                raw = recover_card(obj(link.payload.get('candidate')))
                # Grouped historical searches can have less specific criteria. Do not
                # transfer an affirmative SKU judgement to a different target.
                compared = obj(evidence.get('comparisonCriteria') or evidence.get('criteria'))
                if any(text(compared.get(key)).lower() != text(row.criteria.get(key)).lower()
                       for key in ('name', 'specs', 'model', 'required')):
                    evidence['targetSpecStatus'] = 'unknown'
                    evidence['specComparison'] = {}
                    evidence['specDifference'] = ''
                current = dict(raw)
                if link.offer_id:
                    current.update(title=link.offer.title, details=link.offer.details)
                    # Only the explicit brand field is authoritative; product titles remain clues.
                    if obj(link.offer.payload).get('brand'):
                        current['brand'] = link.offer.payload['brand']
                evidence['brandEvidence'] = brand_evidence(current, row.criteria)
                evidence['brandRelation'] = evidence['brandEvidence']['relation']
                if evidence.get('targetSpecStatus') not in ('included', 'excluded', 'unknown'):
                    evidence['targetSpecStatus'] = 'unknown'
                offer = offer_json(link.offer) if link.offer_id else {
                    'id': 'pool-' + link.candidate_key, 'title': text(raw.get('title')), 'url': safe_url(link.payload.get('url')),
                    'images': image_urls(raw.get('images')), 'supplier_name': text(raw.get('supplierName')),
                    'supplier_url': safe_url(raw.get('supplierUrl')), 'price_text': text(raw.get('priceText')),
                    'sales_text': text(raw.get('salesText')), 'moq_text': text(raw.get('moqText')),
                    'ship_from': text(raw.get('shipFrom')), 'customer_service': {}, 'details': obj(raw.get('details')),
                    'detail_status': 'pending',
                }
                offer['field_evidence'] = dict(raw.get('fieldEvidence') or {})
                for display, field in (('supplier_name', 'supplierName'), ('price_text', 'priceText'), ('sales_text', 'salesText')):
                    if not offer.get(display) and raw.get(field):
                        offer[display] = text(raw[field])
                offer['source_stage'] = 'detail' if offer.get('details', {}).get('capturedAt') else 'search'
                grouped[link.candidate_key] = dict(offer, evidence=evidence,
                    admitted=bool(link.offer_id), stage=link.payload.get('stage') or 'unassessed',
                    planned_rank=link.payload.get('plannedRank'), score=link.payload.get('score'),
                    certificates=link.offer.product.certificates if link.offer_id else [], searches=[])
            grouped[link.candidate_key]['searches'].append({'title': link.request.title, 'criteria': link.request.criteria})
        data['candidates'] = list(grouped.values())
        data['candidates'].sort(key=lambda item: (item['planned_rank'] is None, item['planned_rank'] or 0, item['stage'] == 'excluded', -(item['score'] or 0)))
        data['candidate_counts'] = {key: sum(item['stage'] == key for item in data['candidates']) for key in ('priority', 'review', 'excluded', 'unassessed')}
        data['candidate_counts'].update(total=len(data['candidates']), admitted=sum(item['admitted'] for item in data['candidates']), planned=sum(item['planned_rank'] is not None for item in data['candidates']))
        data['queries'] = [{'title': r.title, 'criteria': r.criteria, 'provenance': r.payload.get('provenance', '')}
                           for r in ImageGrabYouRequest.objects.filter(pk__in=related)]
    return data


def sourcing_response(request):
    rows = ImageGrabYouRequest.objects.filter(parent__isnull=True)
    query = text(request.query_params.get('q'))[:200]
    if request.query_params.get('request_id'):
        row = rows.filter(pk=number(request.query_params['request_id'], 0)).first()
        return Response({'result': 'success', 'data': request_json(row, True)}) if row else Response({'message': '寻源目标不存在'}, status=404)
    if query:
        rows = rows.filter(Q(title__icontains=query) | Q(criteria__name__icontains=query) | Q(criteria__brand__icontains=query))
    paginator = Paginator(rows, number(request.query_params.get('page_size'), 30, 1, 100))
    page = paginator.get_page(number(request.query_params.get('page'), 1))
    return Response({'result': 'success', 'count': paginator.count, 'page': page.number, 'pages': paginator.num_pages,
                     'data': [request_json(row) for row in page.object_list], **overview()})


def overview():
    offers = ImageGrabYouOffer.objects.all()
    complete = offers.filter(detail_status='complete').count()
    return {'metrics': {'requests': ImageGrabYouRequest.objects.filter(parent__isnull=True).count(),
                        'products': ImageGrabYouProduct.objects.count(), 'offers': offers.count(),
                        'complete': complete, 'pending': offers.count() - complete},
            'jobs': [{'run_id': j.run_id, 'status': j.status, 'total': j.total, 'done': j.done,
                      'failed': j.failed, 'username': j.user.username if j.user else '',
                      'updated_at': j.updated_at.isoformat()} for j in ImageGrabYouJob.objects.select_related('user')[:6]]}


class ImageGrabYouView(APIView):
    permission_classes = [ImageGrabAdmin]

    def get(self, request):
        if request.query_params.get('view') == 'requests' or request.query_params.get('request_id'):
            return sourcing_response(request)
        rows = ImageGrabYouProduct.objects.annotate(offer_count=Count('offers')).order_by('-updated_at', '-id')
        if request.query_params.get('view') == 'unassigned':
            rows = rows.filter(source_type='similar').exclude(offers__sourcing_links__isnull=False)
        if request.query_params.get('id'):
            row = rows.filter(pk=number(request.query_params['id'], 0)).first()
            if not row:
                return Response({'message': '商品不存在'}, status=404)
            return Response({'result': 'success', 'data': product_json(row, details=True)})
        query = text(request.query_params.get('q'))[:200]
        if query:
            rows = rows.filter(Q(title__icontains=query) | Q(brand__icontains=query) | Q(category__icontains=query))
        source = text(request.query_params.get('source'))
        if source in ('ranking', 'similar', 'manual'):
            rows = rows.filter(source_type=source)
        ranking = text(request.query_params.get('ranking'))
        category = text(request.query_params.get('category'))
        if ranking:
            rows = rows.filter(scope__rankingKey=ranking)
        if category:
            rows = rows.filter(scope__categoryKey=category)
        paginator = Paginator(rows, number(request.query_params.get('page_size'), 30, 1, 100))
        page = paginator.get_page(number(request.query_params.get('page'), 1))
        scopes = ImageGrabYouProduct.objects.exclude(scope={}).values_list('scope', flat=True)
        rankings, categories = {}, {}
        for scope in scopes:
            scope = obj(scope)
            if scope.get('rankingKey'):
                rankings[scope['rankingKey']] = scope.get('rankingLabel') or scope['rankingKey']
            if scope.get('categoryKey'):
                categories[scope['categoryKey']] = scope.get('categoryName') or scope['categoryKey']
        return Response({
            'result': 'success', 'count': paginator.count, 'pages': paginator.num_pages, 'page': page.number,
            'data': [product_json(row) for row in page.object_list],
            'filters': {'rankings': rankings, 'categories': categories},
            **overview(),
        })

    def post(self, request):
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError('请求必须为对象')
        client_id = text(data.get('client_id'), 64)
        if not re.fullmatch(r'[a-zA-Z0-9_-]{8,64}', client_id):
            raise ValidationError('client_id 无效')
        products, offers = data.get('products', []), data.get('offers', [])
        certificates, job = data.get('certificates', []), data.get('job')
        requests, links, candidates = data.get('requests', []), data.get('links', []), data.get('candidates', [])
        if not all(isinstance(items, list) for items in (products, offers, certificates, requests, links, candidates)):
            raise ValidationError('同步记录必须为数组')
        if len(products) > 25 or len(offers) > 200 or len(certificates) > 500:
            raise ValidationError('单批最多25个商品、200条货源、500条认证记录')
        if len(requests) > 20 or len(links) > 200 or len(candidates) > 200:
            raise ValidationError('单批最多20个寻源目标、200条关联')
        if len(json.dumps(data, ensure_ascii=False).encode()) > 8 * 1024 * 1024:
            raise ValidationError('单批资料过大，请减小批次')
        counts = {'created_products': 0, 'updated_products': 0, 'created_offers': 0, 'updated_offers': 0}
        with transaction.atomic():
            for item in products:
                if not isinstance(item, dict) or not text(item.get('id')):
                    raise ValidationError('商品缺少id')
                key = text(item['id'], 160)
                defaults = dict(title=text(item.get('title'), 500), brand=text(item.get('brand'), 160),
                                category=text(item.get('category'), 160), source_type=text(item.get('sourceType'), 32),
                                source_url=safe_url(item.get('sourceUrl')), scope=obj(item.get('scope')),
                                images=image_urls(item.get('images')), payload=item, synced_by=request.user,
                                certificates=[c for c in certificates if isinstance(c, dict) and c.get('productId') == key])
                _, created = ImageGrabYouProduct.objects.update_or_create(client_id=client_id, external_id=key, defaults=defaults)
                counts['created_products' if created else 'updated_products'] += 1
            for item in offers:
                if not isinstance(item, dict):
                    raise ValidationError('货源必须为对象')
                product = ImageGrabYouProduct.objects.filter(client_id=client_id, external_id=text(item.get('productId'), 160)).first()
                if not product:
                    raise ValidationError('货源所属商品尚未同步')
                key, offer_id = source_key(item)
                details = obj(item.get('details'))
                capture = obj(details.get('optionCollection'))
                completed = capture.get('status') == 'complete' or bool(capture and not capture.get('status') and capture.get('collected') and len(array(capture.get('collected'))) == capture.get('expectedCombinations') and not capture.get('skipped'))
                defaults = dict(offer_id=offer_id, title=text(item.get('title') or product.title, 500),
                                url=safe_url(item.get('url')), supplier_name=text(item.get('supplierName'), 240),
                                supplier_url=safe_url(item.get('supplierUrl')), price_text=text(item.get('priceText'), 240),
                                moq_text=text(item.get('moqText'), 240), sales_text=text(item.get('salesText'), 500),
                                ship_from=text(item.get('shipFrom'), 240),
                                customer_service=obj(item.get('customerService') or details.get('customerService')),
                                images=image_urls(item.get('images') or [m.get('url') for m in array(details.get('media')) if isinstance(m, dict) and m.get('role') == 'main']),
                                details=details, detail_status='complete' if completed else ('partial' if details.get('capturedAt') else 'pending'), payload=item)
                saved_offer, created = ImageGrabYouOffer.objects.update_or_create(product=product, source_key=key, defaults=defaults)
                ImageGrabYouCandidate.objects.filter(request__client_id=client_id, candidate_key=key, offer__isnull=True).update(offer=saved_offer)
                counts['created_offers' if created else 'updated_offers'] += 1
            for item in requests:
                if not isinstance(item, dict) or not text(item.get('id')):
                    raise ValidationError('寻源目标缺少稳定id')
                ImageGrabYouRequest.objects.update_or_create(client_id=client_id, external_id=text(item['id'], 160), defaults={
                    'title': text(item.get('title'), 500), 'criteria': obj(item.get('criteria')),
                    'reference': reference_json(item.get('reference')), 'payload': item})
            for item in links:
                if not isinstance(item, dict):
                    raise ValidationError('候选关联格式无效')
                target = ImageGrabYouRequest.objects.filter(client_id=client_id, external_id=text(item.get('requestId'), 160)).first()
                key, _ = source_key(item)
                offer = ImageGrabYouOffer.objects.filter(product__client_id=client_id, product__external_id=text(item.get('productId'), 160), source_key=key).first()
                if not target or not offer:
                    raise ValidationError('寻源目标或对应货源尚未同步')
                ImageGrabYouCandidate.objects.update_or_create(request=target, candidate_key=key, defaults={'offer': offer, 'evidence': obj(item.get('evidence'))})
            for item in candidates:
                if not isinstance(item, dict):
                    raise ValidationError('独立候选格式无效')
                target = ImageGrabYouRequest.objects.filter(client_id=client_id, external_id=text(item.get('requestId'), 160)).first()
                if not target:
                    raise ValidationError('独立候选所属寻源目标尚未同步')
                url = safe_url(item.get('url'))
                if not re.fullmatch(r'https://detail\.1688\.com/offer/\d+\.html', url):
                    raise ValidationError('独立候选链接无效')
                key, _ = source_key(item)
                offer_rows = ImageGrabYouOffer.objects.filter(product__client_id=client_id, source_key=key)
                if item.get('productId'):
                    offer_rows = offer_rows.filter(product__external_id=text(item['productId'], 160))
                offer = offer_rows.first()
                if item.get('productId') and not offer:
                    raise ValidationError('独立候选声明的入池货源不存在')
                if item.get('stage') not in ('priority', 'review', 'excluded'):
                    raise ValidationError('独立候选状态无效')
                if not isinstance(item.get('candidate'), dict):
                    raise ValidationError('独立候选缺少采集记录')
                rank = item.get('plannedRank')
                if rank is not None and (isinstance(rank, bool) or not isinstance(rank, int) or not 1 <= rank <= 50 or item['stage'] == 'excluded'):
                    raise ValidationError('独立候选补全顺序无效')
                ImageGrabYouCandidate.objects.update_or_create(request=target, candidate_key=key,
                    defaults={'offer': offer, 'evidence': obj(item.get('evidence')), 'payload': item})
            if job is not None:
                if not isinstance(job, dict) or not job.get('run_id'):
                    raise ValidationError('job格式无效')
                items = array(job.get('items'))
                ImageGrabYouJob.objects.update_or_create(client_id=client_id, run_id=text(job['run_id'], 160), defaults={
                    'user': request.user, 'status': text(job.get('status'), 32), 'total': len(items),
                    'done': sum(i.get('status') in ('complete', 'skipped', 'unavailable') for i in items if isinstance(i, dict)),
                    'failed': sum(i.get('status') in ('failed', 'partial', 'blocked') for i in items if isinstance(i, dict)), 'payload': job,
                })
        return Response(dict(result='success', **counts))
