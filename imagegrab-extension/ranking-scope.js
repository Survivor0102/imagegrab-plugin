(() => {
  const STORAGE_KEY = 'imagegrabResearchScope';
  const RANKINGS = [
    { key: 'hot', label: '人气热销', rankingName: 'Most_Popular' },
    { key: 'new', label: '潜力新品', rankingName: 'New_Arrivals' },
    { key: 'trend', label: '近期趋势', rankingName: 'TRENDING' }
  ];
  const CATEGORIES = [
    { key: 'office-culture', label: '办公、文化', cateId: '67' },
    { key: 'apparel-accessories', label: '服饰配件、饰品', cateId: '54' },
    { key: 'womenswear', label: '女装', cateId: '10166' },
    { key: 'packaging', label: '包装', cateId: '68' },
    { key: 'sports-outdoors', label: '运动户外', cateId: '18' },
    { key: 'storage-cleaning', label: '收纳清洁用具', cateId: '201547901' },
    { key: 'kitchenware', label: '日用餐厨饮具', cateId: '201547801' },
    { key: 'toys', label: '玩具', cateId: '1813' },
    { key: 'shoes', label: '鞋', cateId: '1038378' },
    { key: 'underwear', label: '内衣', cateId: '312' },
    { key: 'digital-computers', label: '数码、电脑', cateId: '7' },
    { key: 'hardware-tools', label: '五金、工具', cateId: '59' },
    { key: 'building-materials-home', label: '家装建材', cateId: '13' },
    { key: 'home-textiles', label: '家纺家饰', cateId: '96' },
    { key: 'home-appliances', label: '家用电器', cateId: '6' },
    { key: 'luggage-leather', label: '箱包皮具', cateId: '1042954' },
    { key: 'automotive-supplies', label: '汽车用品', cateId: '122916002' },
    { key: 'childrenswear', label: '童装', cateId: '311' },
    { key: 'personal-care-cleaning', label: '个护/家清', cateId: '130822220' },
    { key: 'menswear', label: '男装', cateId: '10165' },
    { key: 'pets-gardening', label: '宠物及园艺', cateId: '122916001' },
    { key: 'beauty-cosmetics', label: '美容护肤/彩妆', cateId: '97' },
    { key: 'home', label: '居家日用品', cateId: '15' },
    { key: 'lighting', label: '灯饰照明', cateId: '58' },
    { key: 'textiles-leather', label: '纺织、皮革', cateId: '4' },
    { key: 'electrical', label: '电工电气', cateId: '5' },
    { key: 'food-beverage', label: '食品酒水', cateId: '2' },
    { key: 'safety-protection', label: '安全、防护', cateId: '70' },
    { key: 'machinery', label: '机械及行业设备', cateId: '65' },
    { key: 'rubber-plastics', label: '橡塑', cateId: '55' },
    { key: 'chemicals', label: '化工', cateId: '8' },
    { key: 'electronic-components', label: '电子元器件', cateId: '57' },
    { key: 'adult-products', label: '成人用品', cateId: '130823000' },
    { key: 'auto-motorcycle-parts', label: '汽摩及配件', cateId: '71' },
    { key: 'food-service', label: '餐饮生鲜', cateId: '130822002' },
    { key: 'instruments', label: '仪器仪表', cateId: '10208' },
    { key: 'medicine-health', label: '医药、保养', cateId: '66' },
    { key: 'metallurgy-minerals', label: '冶金矿产', cateId: '9' },
    { key: 'building-materials', label: '建材', cateId: '201346017' },
    { key: 'media-broadcast', label: '传媒、广电', cateId: '53' },
    { key: 'steel', label: '钢铁', cateId: '123614001' },
    { key: 'new-energy', label: '新能源', cateId: '202052814' },
    { key: 'business-services', label: '商务服务', cateId: '69' },
    { key: 'agriculture', label: '农业', cateId: '1' },
    { key: 'transportation', label: '交通运输', cateId: '12' },
    { key: 'processing', label: '加工', cateId: '2805' },
    { key: 'printing', label: '印刷', cateId: '72' },
    { key: 'communications', label: '通信产品', cateId: '509' },
    { key: 'machine-tools', label: '机床', cateId: '1426' },
    { key: 'environmental-protection', label: '环保', cateId: '64' },
    { key: 'energy', label: '能源', cateId: '10' },
    { key: 'second-hand-equipment', label: '二手设备转让', cateId: '2829' }
  ];
  const defaults = { rankingKey: 'hot', categoryKey: 'home', categoryName: '居家日用品', cateId: '15', countryCode: 'CN', countryName: '中国' };
  function ranking(key) { return RANKINGS.find(item => item.key === key) || RANKINGS[0]; }
  function category(key) { return CATEGORIES.find(item => item.key === key) || CATEGORIES[0]; }
  function normalize(input = {}) {
    const r = ranking(input.rankingKey);
    const preset = category(input.categoryKey);
    return { rankingKey: r.key, rankingLabel: r.label, rankingName: r.rankingName, categoryKey: preset.key, categoryName: preset.label, cateId: preset.cateId, countryCode: 'CN', countryName: '中国' };
  }
  function fromUrl(value) {
    try {
      const url = new URL(value);
      const r = RANKINGS.find(item => item.rankingName === url.searchParams.get('rankingName')) || RANKINGS[0];
      const cateId = url.searchParams.get('cateId') || defaults.cateId;
      const preset = CATEGORIES.find(item => item.cateId === cateId);
      return preset ? normalize({ rankingKey: r.key, categoryKey: preset.key }) : null;
    } catch { return normalize(defaults); }
  }
  function toUrl(input) {
    const scope = normalize(input);
    if (!scope.cateId) throw Error('请先填写所选大类对应的 1688 类目 ID');
    const url = new URL('https://air.1688.com/kapp/1688-global/sales/ranking');
    for (const [key, value] of [['rankingName', scope.rankingName], ['countryCode', scope.countryCode], ['platform', 'cbu'], ['cateId', scope.cateId], ['cateLevel', '1']]) url.searchParams.set(key, value);
    return url.href;
  }
  globalThis.ImageGrabRankingScope = { STORAGE_KEY, RANKINGS, CATEGORIES, defaults, normalize, fromUrl, toUrl, ranking, category };
})();
