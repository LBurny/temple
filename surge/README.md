# Surge 去广告规则集 (MITM 路径级)

本目录下的规则通过 **MITM(中间人解密)** 对 iOS 客户端做**路径级**广告/埋点屏蔽,相比 DNS 域名屏蔽更精确,**不会误伤主站正常功能**。

## 文件列表

| 文件 | 目标 App | 抓包来源 |
|------|----------|----------|
| `tieba-adblock.surge.conf` | 百度贴吧 iOS `TBClient/12.87.1` | SpiderProxy MITM, iOS 18.7.8 |
| `189-cloud-adblock.surge.conf` | 天翼云盘 iOS `11.1.0` | SpiderProxy MITM, iOS 18.7.8 |

## 原理

- 抓包得到的 HAR 中,`request.url` 是**解密后**的完整地址(含路径)。
- 因此规则用正则匹配**完整 URL 的路径部分**,只 `REJECT` 命中广告/埋点接口。
- 各 App 的正常业务接口(登录、列表、上传等)用路径/域名白名单放行。

## 使用前提 (Surge)

1. 开启 **MITM** 并安装信任根证书(设置 → 关于本机 → 安装描述文件 → 通用 → VPN与设备管理 信任)。
2. 把文件内 `[MITM] hostname` 段复制合并进你的配置。
3. 把 `[Filter]` 内的 `REJECT` 规则加入你的 `[Filter]` 段。
4. 重启 Surge,重开目标 App 生效。

> 路径级规则必须能解密才能命中,`[MITM] hostname` 段是前提;若用纯域名 DNS 屏蔽,精度会下降,请改用规则中的域名级 REJECT。

## 屏蔽内容

来自 HAR 实测,共分两类:

- **埋点/统计**(安全): sofire、gsp0 track.gif、xdplt(头条系)、dlswbr(黑盒)、weirwood-sdk、mlog.bigda、大头条 ad.union 等 / 天翼云盘的 ux.21cn.com、collectRecords、reportToken 等。
- **广告位/推广位**(谨慎,去掉对应卡片): 贴吧 shopGoodsFeed、material/home;天翼云盘 getOpenscreenBanners、getPageBanners、getHomePageSkinBanner、listRecommendCards、splash 配置等。

## 避坑

- 贴吧: 不要整域屏蔽 `tieba.baidu.com` / `tiebapic.baidu.com` / `tb*.bdstatic.com`(主功能与图片)。
- 天翼云盘: `api.cloud.189.cn` 是**唯一 API 域名**,只能路径级屏蔽,严禁整域 REJECT。
