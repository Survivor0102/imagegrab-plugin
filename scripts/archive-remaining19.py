"""Archive an actual Chrome download job; never fetch or manufacture media."""
import csv
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'output' / '2026-11-04-其余19件商品-规格与图片'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        csv.writer(stream).writerows(rows)


def archive(snapshot):
    data = json.loads(snapshot.read_text(encoding='utf-8-sig'))
    job = data['imagegrabRemaining19Job']
    research = data['imagegrabResearchData']
    DEST.mkdir(parents=True, exist_ok=True)
    write_json(DEST / '批次下载记录.json', job)
    write_json(DEST / '研究台数据备份.json', research)
    records, all_skus, issues = [], [], []
    overview = [['序号', '商品名称', '供应商', '发货地', '规格报价行数', '图片文件数', '实际选项组合', '预期选项组合', '结果', '商品链接', '资料文件夹']]
    for item in sorted(job['items'], key=lambda x: x['index']):
        record = {k: item.get(k) for k in ['index', 'title', 'url', 'supplierName', 'shipFrom', 'status', 'skuCount', 'coverage', 'expectedCombinations', 'collectedCombinations', 'skippedCombinations']}
        record['files'], record['issues'] = [], []
        if item.get('status') != 'complete':
            record['issues'].append(item.get('error') or f'批次状态：{item.get("status")}')
        if item.get('coverage') != 'all-rendered-including-soldout':
            record['issues'].append('尚未完成展开售罄规格的复核')
        if not item.get('supplierName') or not item.get('shipFrom'):
            record['issues'].append('供应商或发货地缺失')
        if not item.get('folder'):
            record['issues'].append(item.get('error', '未生成下载目录'))
            records.append(record)
            continue
        folder = DEST / Path(item['folder']).name
        folder.mkdir(exist_ok=True)
        record['directory'] = folder.name
        images_by_url = {}
        for download in item.get('images', []) + item.get('exports', []):
            source = Path(download.get('absolutePath', ''))
            if download.get('state') != 'complete' or not source.is_file():
                record['issues'].append({'download': download.get('filename'), 'state': download.get('state'), 'error': download.get('error', '文件不存在')})
                continue
            image_file = download in item.get('images', [])
            target = folder / ('images' if image_file else '') / source.name
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(source, target)
            raw = target.read_bytes()
            info = {'path': target.relative_to(DEST).as_posix(), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            if not raw:
                record['issues'].append(f'空文件：{target.name}')
            if image_file:
                try:
                    with Image.open(target) as im:
                        im.load()
                        info.update(format=im.format, width=im.width, height=im.height)
                except Exception as error:
                    record['issues'].append(f'图片解码失败：{target.name}：{error}')
                images_by_url[download['url']] = target.relative_to(folder).as_posix()
            record['files'].append(info)
        original = folder / '规格报价.csv'
        saved_json = folder / '货源资料.json'
        if saved_json.is_file():
            saved = json.loads(saved_json.read_text(encoding='utf-8-sig'))
            if saved['offer']['url'] != item['url']:
                record['issues'].append('JSON货源链接与当前商品不匹配')
            if len(saved['offer']['details']['skus']) != item['skuCount']:
                record['issues'].append('JSON规格数与采集记录不同')
            if any(s.get('priceScope') or not s.get('priceText') for s in saved['offer']['details']['skus']):
                record['issues'].append('存在未展示规格单价的选项，详见每行价格口径')
        if original.is_file():
            with original.open(encoding='utf-8-sig', newline='') as stream:
                rows = list(csv.DictReader(stream))
            if len(rows) != item['skuCount']:
                record['issues'].append(f'CSV行数{len(rows)}与采集数{item["skuCount"]}不同')
            fields = list(rows[0]) if rows else ['供应商', '货源链接', '发货地', '规格', '售价', '对应图片链接']
            enriched = [fields + ['本地图片文件']]
            for row in rows:
                local_image = images_by_url.get(row.get('对应图片链接', ''), '')
                enriched.append([row.get(field, '') for field in fields] + [local_image])
                all_skus.append([item['index'], item['title'], row.get('供应商'), item['url'], row.get('发货地'), row.get('规格类别'), row.get('规格'), row.get('选项'), row.get('售价'), row.get('价格说明'), row.get('价格口径'), row.get('库存文字'), f'{folder.name}/{local_image}' if local_image else '', row.get('对应图片链接')])
                if row.get('对应图片链接') and not local_image:
                    record['issues'].append(f'规格图片没有本地文件：{row.get("规格")}')
            write_csv(folder / '规格报价_含本地图片路径.csv', enriched)
        if not item.get('skuCount'):
            record['issues'].append('没有采到规格报价行，需查看商品页面确认')
        if item.get('collectedCombinations') != item.get('expectedCombinations'):
            record['issues'].append('部分选项组合未激活，详见skippedCombinations')
        write_json(folder / '文件核验清单.json', record)
        records.append(record)
        overview.append([item['index'], item['title'], item.get('supplierName'), item.get('shipFrom'), item.get('skuCount'), len(images_by_url), item.get('collectedCombinations'), item.get('expectedCombinations'), '已核验' if not record['issues'] else '存在缺项，详见清单', item['url'], folder.name])
    for record in records:
        if record['issues']:
            issues.append({'index': record['index'], 'title': record['title'], 'issues': record['issues']})
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'jobStatus': job['status'], 'targetCount': len(job['targets']), 'archivedCount': len(records), 'skuRows': sum(r.get('skuCount') or 0 for r in records), 'imageFiles': sum(1 for r in records for f in r['files'] if 'width' in f), 'bytes': sum(f['bytes'] for r in records for f in r['files']), 'issues': issues, 'items': records}
    write_csv(DEST / '商品总览.csv', overview)
    write_csv(DEST / '全部规格报价_含本地图片路径.csv', [['序号', '商品名称', '供应商', '货源链接', '发货地', '规格类别', '规格', '选项', '售价', '价格说明', '价格口径', '库存文字', '本地图片文件', '图片原链接']] + all_skus)
    write_json(DEST / '下载与核验清单.json', report)
    lines = ['# 其余19件商品：规格、报价与图片', '', f'已归档 {len(records)}/19 件，{report["skuRows"]} 行规格报价、{report["imageFiles"]} 个可解码图片文件。', '', '- `商品总览.csv`：供应商、发货地、数量与各商品目录。', '- `全部规格报价_含本地图片路径.csv`：汇总全部已采到的规格售价和对应本地图片。', '- 每个商品目录：`货源资料.json`、`规格报价.csv`、带本地图片路径的CSV、`images/`及文件核验清单。', '- `研究台数据备份.json`：本次采集后的研究台数据（包含原有20件商品），不是插件源码。', '- 图片经过文件大小、SHA-256和Pillow实际解码检查。浏览器下载原文件保留，避免“打开文件夹”入口失效。', '', '## 数据口径', '', '已逐项切换页面可选择的颜色/型号，并展开页面提供的“已售罄商品”；库存不足按页面文字保留。售价、库存、发货地取自当次登录页面，可能包含老客价格，以各行价格说明和货源页面为准，不保证覆盖所有采购数量阶梯或未来价格。页面未列规格名称的单价行标为“默认规格（页面未列名称）”。一张选项图可能由多个尺寸共用，不人为复制成各尺寸独有图片；未给出规格图片的行保留为空，可在商品主图和详情图中查看。图片文件数按实际下载URL计，可能包含相同画面的不同尺寸或编码，并不代表全部内容互不重复。只记录实际可见资料，未核验CCC认证。', '', '## 缺项', '']
    lines += [f'- 商品{x["index"]}：{x["title"]}：{json.dumps(x["issues"], ensure_ascii=False)}' for x in issues] or ['本地文件与数量核验未发现缺项。']
    lines += ['', '## 商品目录', ''] + [f'- [{r["index"]}. {r["title"]}]({r["directory"]}/)' for r in records if r.get('directory')]
    (DEST / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'items'}, ensure_ascii=False))


if __name__ == '__main__':
    archive(Path(sys.argv[1]))
