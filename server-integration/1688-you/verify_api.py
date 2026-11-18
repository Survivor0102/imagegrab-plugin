"""Run via manage.py shell. All fixture writes are rolled back in one transaction."""
from copy import deepcopy
from types import SimpleNamespace
from django.contrib.auth.models import User
from django.db import transaction
from rest_framework.test import APIRequestFactory, force_authenticate
from web.models.imagegrab_you import ImageGrabYouOffer, ImageGrabYouProduct, ImageGrabYouJob, ImageGrabYouRequest, ImageGrabYouCandidate
from web.models.user import GoodsSourcingCandidate, CollectionJob, Goods1688Offer
from web.views.goods.imagegrab_you import ImageGrabYouView

factory = APIRequestFactory()
view = ImageGrabYouView.as_view()
passed = []

def request(method, user=None, data=None, query=''):
    req = factory.post('/api/goods/imagegrab-you/', data, format='json') if method == 'POST' else factory.get('/api/goods/imagegrab-you/' + query)
    if user is not None:
        force_authenticate(req, user=user)
    return view(req)

with transaction.atomic():
    old_counts = [model.objects.count() for model in (GoodsSourcingCandidate, CollectionJob, Goods1688Offer)]
    reader = User.objects.create_user(username='ig_you_verification_reader')
    admin = User.objects.create_user(username='ig_you_verification_admin', is_superuser=True)
    for method in ('GET', 'POST'):
        assert request(method, data={}).status_code in (401, 403)
        assert request(method, reader, {}).status_code == 403
    passed.append('anonymous and registrar blocked on GET and POST')
    payload = {
        'client_id': 'verification-client-a',
        'products': [{'id': 'p1', 'title': '亮亮照明全塑料筒灯 12W', 'brand': '亮亮照明', 'sourceType': 'ranking',
                      'images': ['javascript:alert(1)', 'https://example.com/main.jpg'],
                      'scope': {'rankingKey': 'hot', 'rankingLabel': '人气热销', 'categoryKey': 'home', 'categoryName': '居家日用品'}}],
        'offers': [{'id': 'o1', 'productId': 'p1', 'url': 'https://detail.1688.com/offer/895666369320.html?x=1',
                    'supplierName': '验证供应商', 'shipFrom': '浙江宁波', 'priceText': '¥15',
                    'customerService': {'url': 'https://air.1688.com/chat?loginId=seller'},
                    'details': {'capturedAt': 123, 'optionCollection': {'status': 'complete'},
                                'skus': [{'value': '12W 白光', 'priceText': '¥15', 'imageUrl': 'https://example.com/sku.jpg'}],
                                'media': [{'url': 'https://example.com/detail.jpg', 'role': 'description'}]}}],
        'certificates': [{'productId': 'p1', 'type': 'CCC', 'status': 'unverified', 'number': 'fixture'}],
        'job': {'run_id': 'job1', 'status': 'complete', 'items': [{'status': 'complete'}]},
    }
    first = request('POST', admin, payload)
    assert first.status_code == 200, first.data
    assert first.data['created_products'] == first.data['created_offers'] == 1
    again = deepcopy(payload); again['offers'][0]['id'] = 'different-local-id'
    again['offers'][0]['url'] = 'https://detail.1688.com/offer/895666369320.html?x=2'
    assert request('POST', admin, again).data['updated_offers'] == 1
    assert ImageGrabYouProduct.objects.filter(client_id=payload['client_id']).count() == 1
    assert ImageGrabYouOffer.objects.filter(product__client_id=payload['client_id']).count() == 1
    passed.append('retry and canonical offer deduplication')
    second = deepcopy(payload); second['client_id'] = 'verification-client-b'
    assert request('POST', admin, second).data['created_products'] == 1
    passed.append('same local ids on another device stay isolated')
    row = ImageGrabYouProduct.objects.get(client_id=payload['client_id'], external_id='p1')
    details = request('GET', admin, query=f'?id={row.id}').data['data']
    assert details['offers'][0]['details']['skus'][0]['value'] == '12W 白光'
    assert details['offers'][0]['details']['skus'][0]['imageUrl'].endswith('/sku.jpg')
    assert details['offers'][0]['customer_service']['url'].endswith('loginId=seller')
    assert details['offers'][0]['ship_from'] == '浙江宁波'
    assert details['certificates'][0]['status'] == 'unverified'
    assert details['images'] == ['https://example.com/main.jpg']
    passed.append('SKU/price/image/customer service/certificate preservation and unsafe URL filtering')
    result = request('GET', admin, query='?q=亮亮&source=ranking&ranking=hot&category=home&page_size=1')
    assert result.status_code == 200 and result.data['count'] == 2
    assert len(result.data['data']) == 1 and result.data['pages'] == 2
    assert request('GET', admin, query='?page=bad&page_size=wrong').status_code == 200
    passed.append('query, source/ranking/category filters and pagination')
    broken = deepcopy(payload); broken['products'][0]['title'] = 'must roll back'
    broken['offers'][0]['productId'] = 'missing'
    assert request('POST', admin, broken).status_code == 400
    row.refresh_from_db(); assert row.title != 'must roll back'
    assert request('POST', admin, {'client_id': 'verification-client-c', 'products': 'wrong'}).status_code == 400
    passed.append('invalid input rolls the whole batch back')
    target = {'id': 'fixture-request', 'title': 'fixture-target', 'criteria': {'name': 'fixture-target', 'brand': '亮亮照明', 'specs': '12W'},
              'reference': {'image': 'data:image/png;base64,AAAA'}, 'provenance': 'recorded-input'}
    membership = {'requestId': target['id'], 'productId': 'p1', 'url': payload['offers'][0]['url'],
                  'evidence': {'criteria': target['criteria'], 'targetSpecStatus': 'included'},
                  'stage': 'priority', 'plannedRank': 1, 'score': 96}
    batch = {'client_id': payload['client_id'], 'requests': [target], 'links': [membership]}
    for _ in range(2):
        reply = request('POST', admin, batch)
        assert reply.status_code == 200, reply.data
    root = ImageGrabYouRequest.objects.get(client_id=payload['client_id'], external_id=target['id'])
    assert root.candidates.count() == 1
    result = request('GET', admin, query=f'?request_id={root.id}').data['data']
    assert result['reference']['image'] == target['reference']['image']
    assert len(result['candidates']) == 1 and result['candidates'][0]['evidence']['targetSpecStatus'] == 'included'
    assert result['candidates'][0]['stage'] == 'priority' and result['candidates'][0]['planned_rank'] == 1
    assert result['candidates'][0]['evidence']['brandRelation'] == 'unknown'
    assert result['candidates'][0]['details']['skus'][0]['value'] == '12W 白光'
    assert result['candidates'][0]['certificates'][0]['status'] == 'unverified'
    assert request('GET', admin, query='?view=requests&q=fixture-target').data['count'] == 1
    for user in (None, reader):
        assert request('GET', user, query=f'?request_id={root.id}').status_code in (401,403)
    passed.append('sourcing target and membership retry are idempotent; previews, supplier details and admin scope preserved')
    bad = deepcopy(batch); bad['client_id'] = 'verification-client-c'; bad['requests'] = []
    assert request('POST', admin, bad).status_code == 400
    bad = deepcopy(batch); bad['requests'][0]['title'] = 'must roll back'; bad['links'][0]['productId'] = 'missing'
    assert request('POST', admin, bad).status_code == 400
    root.refresh_from_db(); assert root.title == 'fixture-target'
    passed.append('cross-client association rejected and target update rolls back on a missing supplier')
    child = ImageGrabYouRequest.objects.create(client_id=root.client_id, external_id='fixture-child', title='earlier query',
                criteria={'name': 'less-specific query'}, parent=root)
    ImageGrabYouCandidate.objects.create(request=child, offer=root.candidates.first().offer, candidate_key=root.candidates.first().candidate_key,
                evidence={'criteria': child.criteria, 'targetSpecStatus': 'included'})
    result = request('GET', admin, query=f'?request_id={root.id}').data['data']
    assert len(result['queries']) == 2 and len(result['candidates']) == 1
    assert result['candidates'][0]['evidence']['targetSpecStatus'] == 'included'
    assert len(result['candidates'][0]['searches']) == 2
    assert request('GET', admin, query='?view=requests&q=earlier').data['count'] == 0
    assert request('POST', admin, batch).status_code == 200
    child.refresh_from_db(); assert child.parent_id == root.id
    passed.append('multiple searches stay under one target; duplicate suppliers collapse without losing query provenance')
    root.candidates.all().delete()
    result = request('GET', admin, query=f'?request_id={root.id}').data['data']
    assert result['candidates'][0]['evidence']['targetSpecStatus'] == 'unknown'
    passed.append('broad historical evidence cannot assert a different target specification is included')
    orphan = ImageGrabYouProduct.objects.create(client_id=payload['client_id'],external_id='orphan',title='fixture-orphan',source_type='similar')
    ImageGrabYouOffer.objects.create(product=orphan,source_key='1688:999999',title='fixture-orphan',url='https://detail.1688.com/offer/999999.html')
    assert request('GET',admin,query='?view=unassigned&q=fixture-orphan').data['count']==1
    assert request('GET',admin,query='?source=ranking&q=亮亮').data['count']==2
    passed.append('unassociated history remains discoverable; rankings remain available')
    saved_offer = child.candidates.first().offer
    saved_offer.details = dict(saved_offer.details, attributes=[{'name':'品牌','value':'亮亮'}])
    saved_offer.save(update_fields=['details'])
    result = request('GET',admin,query=f'?request_id={root.id}').data['data']
    assert result['candidates'][0]['evidence']['brandRelation']=='unknown'
    assert '简称' in result['candidates'][0]['evidence']['brandEvidence']['reason']
    passed.append('possible brand abbreviation stays pending rather than being labelled as a different brand')
    pool_target = {'id': 'pool-only-target', 'title': 'pool-only', 'criteria': {'name': '筒灯', 'specs': '12W', 'limit': 20}}
    rows = [{'requestId': pool_target['id'], 'url': f'https://detail.1688.com/offer/{900000+i}.html',
             'candidate': {'title': f'待核筒灯 {i}', 'images': ['https://example.com/a.jpg'], 'supplierName': '独立候选'},
             'evidence': {'criteria': pool_target['criteria'], 'targetSpecStatus': 'unknown'},
             'stage': 'excluded' if i == 24 else 'review', 'plannedRank': i+1 if i < 20 else None, 'score': 50-i}
            for i in range(25)]
    archive_counts = (ImageGrabYouProduct.objects.count(), ImageGrabYouOffer.objects.count())
    pool_batch = {'client_id': payload['client_id'], 'requests': [pool_target], 'candidates': rows}
    for _ in range(2):
        reply = request('POST', admin, pool_batch)
        assert reply.status_code == 200, reply.data
    pool_root = ImageGrabYouRequest.objects.get(client_id=payload['client_id'], external_id=pool_target['id'])
    result = request('GET', admin, query=f'?request_id={pool_root.id}').data['data']
    assert result['candidate_count'] == 25
    assert result['candidate_counts'] == {'priority': 0, 'review': 24, 'excluded': 1, 'unassessed': 0, 'total': 25, 'admitted': 0, 'planned': 20}
    assert [row['planned_rank'] for row in result['candidates'][:20]] == list(range(1,21))
    assert (ImageGrabYouProduct.objects.count(), ImageGrabYouOffer.objects.count()) == archive_counts
    passed.append('25 independent candidates retained, twenty pending ranks preserved, no forced admission, retry idempotent')
    admitted = deepcopy(payload); admitted['products'][0]['id'] = 'pool-admission'
    admitted['offers'][0].update(productId='pool-admission', url=rows[0]['url'])
    assert request('POST', admin, admitted).status_code == 200
    result = request('GET', admin, query=f'?request_id={pool_root.id}').data['data']
    assert result['candidate_count'] == 25 and result['candidate_counts']['admitted'] == 1
    assert result['candidates'][0]['details']['skus'][0]['value'] == '12W 白光'
    assert request('POST', admin, pool_batch).status_code == 200
    assert pool_root.candidates.count() == 25
    passed.append('later real admission attaches to existing candidate without duplication or lost pending status')
    other = deepcopy(pool_batch); other['client_id'] = 'verification-client-b'
    assert request('POST', admin, other).status_code == 200
    other_root = ImageGrabYouRequest.objects.get(client_id=other['client_id'], external_id=pool_target['id'])
    assert not other_root.candidates.filter(offer__isnull=False).exists()
    broken = deepcopy(pool_batch); broken['candidates'][0]['plannedRank'] = 51
    assert request('POST', admin, broken).status_code == 400
    broken = deepcopy(pool_batch); broken['candidates'][0]['stage'] = 'excluded'
    assert request('POST', admin, broken).status_code == 400
    broken = deepcopy(pool_batch); broken['candidates'][0]['url'] = 'https://malicious.example/offer/1.html'
    assert request('POST', admin, broken).status_code == 400
    broken = deepcopy(pool_batch); broken['candidates'][0]['requestId'] = 'missing'
    assert request('POST', admin, broken).status_code == 400
    passed.append('pool sync rejects foreign URLs, missing targets and invalid or excluded planned ranks; clients isolated')
    assert [model.objects.count() for model in (GoodsSourcingCandidate, CollectionJob, Goods1688Offer)] == old_counts
    passed.append('existing 1688 tables unchanged')
    transaction.set_rollback(True)
print({'passed': passed, 'fixtures': 'rolled back; existing data preserved'})
