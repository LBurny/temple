// 知乎广告补丁 —— 移除 JSON 响应里服务端下发的广告插卡（ad_info）
// 2026-11-21 发现：问题详情页回答流 api.zhihu.com/questions/<id>/feeds 会把广告卡放在
// 响应根部的 ad_info 字段里（position=插在第几条之后，ad.creatives[0].title 就是广告文案），
// 客户端据此把「华为终端 / 某品牌提问」卡片插进回答列表。常见的第三方脚本没覆盖这个接口。
//
// 策略：解析 JSON → 删根部 ad_info → 删 data[] 里 type/target_type 为 ad 的项 → 原样回写。
// 解析失败一律原样放过，绝不弄坏页面。

(function () {
  var AD_KEYS = ['ad_info', 'ads_info', 'promotion_info'];

  function isAdItem(it) {
    if (!it || typeof it !== 'object') return false;
    var t = (it.type || '') + '|' + (it.target_type || '');
    return /(^|\|)(ad|ad_item|promotion|paid_promotion)(\||$)/i.test(t);
  }

  function strip(text) {
    var o = JSON.parse(text), changed = false, i;
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (i = 0; i < AD_KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(o, AD_KEYS[i])) { delete o[AD_KEYS[i]]; changed = true; }
      }
      if (Array.isArray(o.data)) {
        var kept = [];
        for (i = 0; i < o.data.length; i++) {
          if (isAdItem(o.data[i])) changed = true; else kept.push(o.data[i]);
        }
        if (kept.length !== o.data.length) o.data = kept;
      }
    }
    return changed ? JSON.stringify(o) : null;
  }

  try {
    var res = strip($response.body);
    $done(res === null ? {} : { body: res });
  } catch (err) {
    $done({});
  }
})();
