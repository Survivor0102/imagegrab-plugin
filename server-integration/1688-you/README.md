# 网站端1688_you增量源码

对应插件1.11.2，目标项目 `/root/Shop`。这是现有Django/Vue网站的增量源码，不是独立可运行网站；数据库和网站账号沿用现有系统，不包含settings、密码、访问令牌或数据库转储。1.11.1已完成真实同步；1.11.2增加已保存卡片字段恢复和品牌线索展示，普通Chrome已核对真实候选。

## 已部署内容

- `backend/web/models/imagegrab_you.py`：商品、货源、任务快照、寻源目标、候选关联五种模型；候选关联可在未入池时保留独立候选记录。
- `backend/web/migrations/0078_imagegrab_you.py`：在现有 `goods` 中建三张独立表，迁移依赖以文件为准。
- `backend/web/migrations/0079_imagegrab_you_sourcing_links.py`：只新增 `imagegrab_you_request`、`imagegrab_you_candidate` 两表，引用原货源，不搬动或删除原档案。
- `backend/web/views/goods/imagegrab_you.py`：`/api/goods/imagegrab-you/` 管理员GET/POST接口。
- `backend/web/views/goods/imagegrab_you_evidence.py`：只读恢复搜索卡片字段，区分标题品牌线索和详情明确字段。首次安装也必须复制此文件。
- `frontend/src/views/goods/ImageGrabYou.vue`：默认按原产品查看候选，保留榜单、待归属、全部档案；品牌关系和目标规格状态可分别筛选。
- `install.py`：首次安装时校验四个目标文件基线，备份并加入模型导入、URL、路由和导航。它不负责运行迁移或构建。
- `baseline-hashes.json`：部署前四个目标文件的摘要，不是当前服务器文件摘要。
- `verify_api.py`：通过Django shell执行的真实数据库事务测试；所有测试夹具最后回滚。

新增导航使用原1688的 `user.isAdmin()`，后端用原 `is_admin()`。新路由增加管理员守卫；原1688组件、接口和表保留。

## 当前服务器状态

当前服务器已运行0078、0079和0080迁移，已完成前端构建及服务加载。1.11.2仅更新视图、辅助函数和前端，不新增迁移。**不要在已安装的当前服务器再次执行install.py**，它会因基线变化拒绝；不要为绕过检查修改基线。

服务器修改前备份：`/root/Shop/.imagegrab-you/backups/20261115-230712`。服务器已有其他未提交改动，不能整树覆盖、reset或clean。

本轮增量备份：`/root/Shop/.imagegrab-you/backups/20261116-request-view`，含更新前组件、视图、模型、模型导入及三个原有独立表的完整档案。历史恢复仅按保留的搜索条件关联；两次亮亮照明查询按用户明确确认挂同一原产品，保留查询条件。恢复后2个原产品、3份条件、6条候选关联，亮亮4个候选、皮筋2个，另1条无搜索证据的球泡待归属。

目标网站入口为 `/static/frontend/goods/ImageGrabYou`。部署构建使用：

```bash
export PATH=/root/.nvm/versions/node/v23.3.0/bin:$PATH
cd /root/Shop/frontend
npm run build
```

该项目构建写入 `backend/static/frontend`，当前配置不清空旧资源。Django解释器为 `/root/anaconda3/bin/python`，服务单元为 `shop.service`。不要因本文存在而重复迁移、重启；后续实际更新按改动选择必要动作。

在**未安装且基线完全相同**的副本首次安装时，将本目录放在项目暂存区，执行install.py后核对四个接入点，运行 `manage.py migrate web 0080 --noinput`、`manage.py check`、`manage.py makemigrations --check --dry-run`，再构建前端并按服务实际状态加载更新。其他环境须先人工核对迁移编号与代码基线。首次安装不会凭空恢复历史输入；需使用新版插件同步实际保存的关联。

## 接口和数据边界

- GET：分页列表，`id`详情，`q`、`source`、`ranking`、`category`筛选，统计和最近任务快照。
- GET `view=requests`：原产品列表；`request_id`：原产品及候选详情、历次条件；`view=unassigned`：缺少搜索关联的历史寻源档案。
- POST：`client_id`及 `products`、`offers`、`certificates`，可带 `job`；按批次事务更新。
- POST增加 `requests`、`links`、`candidates`；必须先同步商品与货源，再同步原产品，最后同步候选关联或未入池候选；关联仅可引用同一client_id内的数据。
- 商品唯一键 `(client_id, external_id)`；货源唯一键 `(product, source_key)`。
- 单批上限25个商品、200条货源、500条认证、20个目标、200条关联、8MiB。插件使用更小的20条/约650KB批次适应代理限制。
- 图片为URL，完整SKU等保存在货源JSON字段；不是新的图片托管服务。
- 新版寻源输入额外保存不超过640像素的原图预览；本地原图不缩小。旧记录未保存原图时明确显示缺失，不用候选货源图冒充原图。
- 任务状态为主动同步的快照，不是服务器爬取队列；暂不提供服务器端编辑和删除接口。

## 验证与回退

验证证据在项目 `evidence/2026-11-15/`、`evidence/2026-11-16/`，说明在 `docs/1688_you服务器展示台.md`。本轮102项插件回归通过，服务器13组事务断言及已部署网页的分组、筛选、SKU、刷新、窄屏、未登录权限验证通过；网页验证用隔离后台Chrome，不冒充日常Chrome插件实测。

若需要回退，先备份新增表数据；按本次接入点撤销新增导航、路由、URL与模型导入并重新构建。先对照当前源码与上述备份逐处核对，避免覆盖其他改动。迁移回退0079会删除本轮两张关联表；继续回退0078会删除最初三张档案表，只有在明确允许丢弃对应数据时才可执行；不触碰原1688表。

## 1.11.1独立候选同步

0080迁移仅扩展自有imagegrab_you_candidate表：新增稳定链接键、独立候选payload，并允许offer暂为空。原有候选按source_key补键，已有货源关联保留。网站为55条亮亮候选保留1条优先、42条待核、11条排除和1条历史待评估；已入池4条是另一维度，不能与这些状态相加。默认20条待核/补全队列已核验，尚未对这20条重新联网补全。服务器16组事务检查通过且夹具回滚，普通Chrome中真实同步224条独立候选关联，原业务表保持不变。

## 1.11.2只读字段恢复

新增 `imagegrab_you_evidence.py`，GET时从候选自身保存文本恢复报价、销量和供应商；不覆盖已采到的字段，不写回数据库，不借用店铺所在地推断发货地。标题品牌线索与明确详情品牌分开返回；详情有明确字段时优先，简称或冲突仍待核。Vue增加来源说明、疑似品牌筛选与明确待补全文案。

当前服务器已于2026年11月17日更新API、辅助文件和Vue组件，Django检查、无迁移检查、前端构建及普通Chrome真实页面核验通过。备份为 `/root/Shop/.imagegrab-you/backups/20261117-evidence-fields`。首次安装的复制清单也已加入辅助文件；已安装环境仅按经核对的现状更新这三份源码并构建/加载服务，不重跑首次安装脚本。纯函数回归：`python -m unittest discover -s server-integration/1688-you -p test_evidence.py -v`（4项）。
