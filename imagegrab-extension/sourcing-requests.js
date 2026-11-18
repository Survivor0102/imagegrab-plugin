/* Stable search targets and explicit candidate membership, independent of suppliers. */
(() => {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const clean = x => String(x || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  function fingerprint(value) {
    return [2166136261, 2246822519, 3266489917, 668265263].map(seed => {
      let hash = seed;
      for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
      return (hash >>> 0).toString(16).padStart(8, '0');
    }).join('');
  }
  function snapshot(state, branch = 'manual', legacy = false) {
    const criteria = copy(state.criteria || {}), reference = legacy ? null : copy(state.reference || null);
    const identity = ['name', 'brand', 'category', 'specs', 'model', 'required'].map(k => clean(criteria[k]));
    const image = reference?.image || reference?.original || '';
    if (!identity.some(Boolean) && !image) return null;
    const signature = JSON.stringify([identity, image ? fingerprint(image) : '']);
    return { id: `${legacy ? 'legacy' : 'request'}-v1-${fingerprint(signature)}`,
      title: criteria.name || criteria.category || '图片寻源', criteria, reference,
      branch, provenance: legacy ? 'saved-criteria' : 'recorded-input',
      createdAt: Date.now(), updatedAt: Date.now() };
  }
  function canonical(value) {
    try { const u = new URL(value); const m = u.pathname.match(/^\/offer\/(\d+)\.html$/);
      return /(^|\.)1688\.com$/i.test(u.hostname) && m ? `https://detail.1688.com/offer/${m[1]}.html` : ''; } catch { return ''; }
  }
  const POOL_KEYS = ['imagegrabSourcingData', 'imagegrabSourcingAutoRun', 'imagegrabSourcingSubstituteData'];
  function collect(data, pools = {}) {
    const requests = new Map((data.sourcingRequests || []).map(r => [r.id, copy(r)])), links = [];
    for (const offer of data.offers || []) {
      const memberships = offer.sourcingRequests || [];
      if (memberships.length) {
        for (const member of memberships) if (requests.has(member.requestId)) {
          const target = requests.get(member.requestId), evidence = copy(member.evidence || {});
          if (globalThis.ImageGrabSubstituteMatch && offer.details)
            Object.assign(evidence, ImageGrabSubstituteMatch.compare({ title: offer.details.title || offer.title, details: offer.details }, target.criteria));
          links.push({ requestId: member.requestId, productId: offer.productId, url: offer.url, evidence });
        }
      } else if (offer.sourcingEvidence?.criteria) {
        const request = snapshot({ criteria: offer.sourcingEvidence.criteria }, 'history', true);
        if (request) {
          requests.set(request.id, request);
          const evidence = copy(offer.sourcingEvidence);
          if (globalThis.ImageGrabSubstituteMatch && offer.details)
            Object.assign(evidence, ImageGrabSubstituteMatch.compare({ title: offer.details.title || offer.title, details: offer.details }, request.criteria));
          links.push({ requestId: request.id, productId: offer.productId, url: offer.url, evidence });
        }
      }
    }
    const candidates = new Map();
    const offersByUrl = new Map((data.offers || []).map(offer => [canonical(offer.url), offer]));
    for (const [index, key] of POOL_KEYS.entries()) {
      const state = pools[key];
      if (!state || !(state.candidates || []).length) continue;
      let request = snapshot(state, ['manual', 'automatic', 'substitute'][index]);
      if (!request) continue;
      // Reuse only an identical saved input. Similar titles cannot merge targets.
      const legacyId = snapshot(state, 'history', true)?.id;
      if (!state.reference && requests.has(legacyId)) request.id = legacyId;
      request.updatedAt = state.updatedAt || state.finishedAt || state.startedAt || request.updatedAt;
      requests.set(request.id, request);
      const criteria = { ...state.criteria, hasImage: !!state.reference?.image || !!state.reference?.original || !!state.criteria?.hasImage };
      const rows = (state.candidates || []).map(row => {
        const offer = offersByUrl.get(canonical(row.url));
        return { ...copy(row), ...(offer?.details ? { details: copy(offer.details) } : {}), ...(state.evaluations?.[canonical(row.url)] || {}) };
      });
      const match = key === 'imagegrabSourcingSubstituteData' ? globalThis.ImageGrabSubstituteMatch : globalThis.ImageGrabSourcingMatch;
      const report = match?.screen(rows, criteria);
      if (!report) throw Error('寻源筛选模块未加载，不能跳过独立候选池');
      const all = report.all || [...report.shortlist, ...report.remaining, ...report.review, ...report.excluded];
      const limit = Math.min(50, Math.max(1, Number(criteria.limit) || (index === 2 ? 20 : 10)));
      const queue = [...report.shortlist, ...report.remaining, ...report.review].slice(0, limit);
      const planned = new Map(queue.map((row, rank) => [canonical(row.url), rank + 1]));
      for (const row of all) {
        const url = canonical(row.url); if (!url) continue;
        const offer = offersByUrl.get(url);
        candidates.set(`${request.id}|${url}`, {
          requestId: request.id, url, ...(offer ? { productId: offer.productId } : {}),
          candidate: copy(row), evidence: { ...Object.fromEntries(['brandRelation', 'brandEvidence', 'targetSpecStatus', 'specComparison', 'specDifference', 'reasons', 'missing', 'excluded', 'sources', 'evaluation'].filter(key => row[key] !== undefined).map(key => [key, copy(row[key])])), criteria: copy(state.criteria), comparisonCriteria: copy(state.criteria) },
          stage: row.status === 'excluded' ? 'excluded' : row.status === 'candidate' ? 'priority' : 'review',
          plannedRank: planned.get(url) || null, score: Number.isFinite(row.score) ? row.score : null,
          poolKey: key, observedAt: state.updatedAt || state.finishedAt || state.startedAt || null,
        });
      }
    }
    return { requests: [...requests.values()], links, candidates: [...candidates.values()] };
  }
  globalThis.ImageGrabSourcingRequests = { snapshot, collect, canonical, POOL_KEYS };
})();
