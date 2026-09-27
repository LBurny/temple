# Mextin 加密订阅解密

解决「机场只允许 Mextin 客户端」的问题。适用于 **SpeedCat / 闪电猫** 及一切开启了「订阅加密」的机场。

## 背景

机场开启 **订阅加密** 后，下发订阅的内容不再是明文节点，而是：

```
Base64( nonce[12] || AES-256-GCM 密文 || tag[16] )
密钥 = SHA256(订阅加密密码)
```

只有配套 App 会解密。你在 Loon / Surge / Shadowrocket 里直接订阅，拿到的是**Base64 乱码或空响应**，所以用不了。

> 这不是 User-Agent 检测。改 UA 没用，必须解密响应体。

## 文件

| 文件 | 用途 |
|---|---|
| `script/mextin-decode.js` | 解密脚本（Loon / Surge / QX 通用） |
| `module/loon-mextin-decode.plugin` | Loon 插件 |
| `module/surge-mextin-decode.sgmodule` | Surge 模块 |
| `module/quantumultx-mextin-decode.conf` | QX 配置片段 |

## 使用（两步）

1. **改密码**：打开 `script/mextin-decode.js`，把开头附近的 `SUBSCRIPTION_PASSWORD` 改成你的**订阅加密密码**。
   QX 用户还需把 `ICLOUD_FILE_PATH` 改成任意文件名（本地落盘用，可保留默认）。
2. **改域名**：把模块/插件里 `[Mitm]` / `hostname` 的域名换成你的订阅域名。

然后导入并开启 MITM 信任证书。**订阅链接保持原样**，不要再用 Sub-Store 转发，直接填原始订阅地址。

### 导入链接

- Loon：`https://raw.githubusercontent.com/LBurny/temple/main/mextin/module/loon-mextin-decode.plugin`
- Surge：`https://raw.githubusercontent.com/LBurny/temple/main/mextin/module/surge-mextin-decode.sgmodule`

## 已验证

脚本已与 Node 原生 `crypto` 交叉验证：SHA-256 一致、AES-256-GCM 双向互通、篡改/错误密钥能被 GCM 认证拒绝、明文与空响应会原样放行不破坏。

## 密码从哪来

向机场主索取，或参考公开的逆向脚本（如 `speedcat.sub.decode.js`，密码 `L1QdZCzcPPvNs3cd4KKP`）。
