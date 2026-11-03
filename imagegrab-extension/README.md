# 图提取 · ImageGrab

一个基于 Manifest V3 的 Chrome 电商图片提取下载插件。

## 支持平台

- 淘宝 / 天猫
- 京东
- 拼多多商家版相关域名

## 本地安装

1. 打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录（包含 `manifest.json` 的 `imagegrab-extension` 文件夹）。
5. 打开支持的商品详情页，点击右下角“获取图片”。

## 设计说明

- `content.js` 负责扫描 `img`、`srcset`、懒加载属性和背景图。
- `background.js` 负责在扩展页面之间传递结果并调用下载权限。
- `gallery.html` / `gallery.js` 提供勾选、反选、批量下载和 PNG 转换。
- 跨域服务器不允许 CORS 时，插件会提示并启动原图兜底下载；这是浏览器安全策略限制。
