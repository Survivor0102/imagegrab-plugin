"""Pure offline regressions: python server-integration/1688-you/test_evidence.py"""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).parent / 'backend/web/views/goods/imagegrab_you_evidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class SavedCardEvidence(unittest.TestCase):
    def test_missing_columns_recovered_from_same_card_only(self):
        raw = {'title': '理星照明LED筒灯12W', 'visibleText': '理星照明LED筒灯12W ¥ 8 .9 60件起批 已售200+件 兰山区顺冠神州光科亚明照明灯具厂'}
        recovered = evidence.recover_card(raw)
        self.assertEqual(recovered['priceText'], '¥8.9')
        self.assertEqual(recovered['salesText'], '已售200+件')
        self.assertEqual(recovered['supplierName'], '兰山区顺冠神州光科亚明照明灯具厂')
        self.assertNotIn('shipFrom', recovered)
        self.assertNotIn('priceText', raw)

    def test_captured_columns_never_overwritten_and_blank_text_never_fabricates(self):
        raw = {'title': '筒灯', 'priceText': '¥12', 'supplierName': '详情供应商', 'visibleText': '筒灯 ¥8.9 兰山区某灯具厂'}
        recovered = evidence.recover_card(raw)
        self.assertEqual(recovered['priceText'], '¥12')
        self.assertEqual(recovered['supplierName'], '详情供应商')
        self.assertEqual(evidence.recover_card({'title': '工厂直供筒灯'})['fieldEvidence'], {})
        self.assertNotIn('supplierName', evidence.recover_card({'title': '某灯具厂', 'visibleText': '某灯具厂'}))

    def test_title_clue_remains_distinct_from_confirmed_brand(self):
        result = evidence.brand_evidence({'title': '理星照明LED筒灯12W'}, {'brand': '亮亮照明'})
        self.assertEqual(result['target'], '亮亮照明')
        self.assertEqual(result['clue'], '理星照明')
        self.assertEqual(result['relation'], 'unknown')
        self.assertEqual(result['clueRelation'], 'different')
        self.assertIn('疑似不同品牌', result['reason'])

    def test_explicit_attributes_override_clue_and_placeholder_never_proves_brand(self):
        raw = {'title': '理星照明LED筒灯', 'details': {'attributes': [{'name': '品牌', 'value': '亮亮照明'}]}}
        self.assertEqual(evidence.brand_evidence(raw, {'brand': '亮亮照明'})['relation'], 'same')
        raw['details']['attributes'][0]['value'] = 'other'
        result = evidence.brand_evidence(raw, {'brand': '亮亮照明'})
        self.assertEqual(result['relation'], 'unknown')
        self.assertEqual(result['clueRelation'], 'different')
        self.assertEqual(evidence.brand_evidence(raw, {})['reason'], '未提供可核对的目标品牌')
        raw['details']['attributes'][0]['value'] = '亮亮'
        self.assertIn('简称', evidence.brand_evidence(raw, {'brand': '亮亮照明'})['reason'])


if __name__ == '__main__':
    unittest.main()
