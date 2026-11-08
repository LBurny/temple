// 网易云 xeapi 响应的「红点/角标」清理（fail-safe：解析失败原样放行）
// 只处理 JSON（明文）；AES/二进制响应 JSON.parse 会抛错 → 不改
(function () {
  var url = (typeof $request !== 'undefined' && $request && $request.url) || '';
  var body = $response.body;

  var DOT_KEY = /(red_?dot|red_?point|red_?badge|badge|bubble|new_?flag|hot_?flag|unread|notice_?count|dot_?type|dot_?num|dot_?count)/i;
  var hits = [];

  function clean(o, path) {
    if (!o || typeof o !== 'object') return 0;
    var n = 0;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      var p = path ? path + '.' + k : k;
      if (DOT_KEY.test(k)) {
        hits.push(p + '=' + JSON.stringify(v).slice(0, 40));
        try {
          if (typeof v === 'boolean') o[k] = false;
          else if (typeof v === 'number') o[k] = 0;
          else if (typeof v === 'string') o[k] = '';
          else if (v && typeof v === 'object') o[k] = Array.isArray(v) ? [] : {};
          else delete o[k];
          n++;
        } catch (e) {}
      } else if (v && typeof v === 'object') {
        n += clean(v, p);
      }
    }
    return n;
  }

  try {
    if (typeof body !== 'string' || body.length < 2) return $done({});
    var j = JSON.parse(body);
    var topKeys = Object.keys(j).slice(0, 12).join(',');
    var changed = clean(j, '');
    console.log('[NeteaseClean] ' + url.split('?')[0].split('/').slice(-2).join('/') +
      ' top=' + topKeys + ' changed=' + changed + ' hits=' + hits.slice(0, 6).join(' | '));
    if (!changed) return $done({});
    $done({ body: JSON.stringify(j) });
  } catch (e) {
    $done({});
  }
})();
