/*******************************************************
 * Reddit 去广告 / 关 NSFW 提示
 * Surge http-response 脚本 (gql.reddit.com, gql-fed.reddit.com)
 *
 * 新版 iOS App 使用 SDUI(Served-Driven UI), 广告判定依据抓包实测:
 *   data.*.elements.edges[].node.adPayload != null   => 广告边 (主信号)
 *   data.*.elements.edges[].node.cells[].__typename
 *        in [AdMetadataCell, CallToActionCell]       => 广告边 (辅信号)
 *   data.postsInfoByIds[].__typename == "ProfilePost" => 广告帖
 *   data.postInfoById.pdpCommentsAds.adPosts[]        => 详情页广告
 *   data.children.commentsPageAds[]                   => 评论区广告
 *
 * 设计原则:
 *   1) fail-open —— 任何异常/非 JSON 一律原样返回, 绝不弄坏响应
 *   2) 只做「数组收缩」和「布尔翻转」, 不删键、不写 null, 保证结构合法
 *   3) 改动才重写响应, 未改动直接放行
 *******************************************************/

(function () {
  var DEFAULT_NSFW = 'Nsfw';
  var MAX_DEPTH = 32;
  var changed = false;

  function out(obj) {
    if (obj && changed) {
      try { $done({ body: JSON.stringify(obj) }); return; } catch (e) {}
    }
    $done({});
  }

  // ---------- 参数 ----------
  // Surge 的 argument= 可能以字符串或对象形式注入, 两者都兼容
  var NSFW = DEFAULT_NSFW;
  try {
    if (typeof $argument !== 'undefined' && $argument !== null) {
      if (typeof $argument === 'string') {
        var s = $argument.trim();
        if (s) {
          if (s.charAt(0) === '{') {           // JSON 字符串
            try {
              var o = JSON.parse(s);
              if (o && o.NSFW != null) NSFW = String(o.NSFW);
            } catch (e2) {}
          } else {
            NSFW = s;                          // 直接就是 NSFW 值
          }
        }
      } else if (typeof $argument === 'object' && $argument.NSFW != null) {
        NSFW = String($argument.NSFW);
      }
    }
  } catch (e) {}

  // ---------- 解析 ----------
  var obj = null;
  try {
    var raw = (typeof $response !== 'undefined' && $response) ? $response.body : null;
    if (!raw) { $done({}); return; }
    obj = JSON.parse(raw);
  } catch (e) { $done({}); return; }
  if (!obj || typeof obj !== 'object') { $done({}); return; }

  // ---------- 广告判定 ----------
  function isAdNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.adPayload !== undefined && node.adPayload !== null) return true; // 主信号
    if (node.__typename === 'AdPost') return true;
    if (node.isAdPost === true) return true;
    var cells = node.cells;
    if (Array.isArray(cells)) {
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (c && typeof c === 'object') {
          var t = c.__typename || c.typename;
          if (t === 'AdMetadataCell' || t === 'CallToActionCell') return true;
        }
      }
    }
    return false;
  }

  // ---------- base64 (分页游标用, 不依赖 btoa) ----------
  function b64(s) {
    var C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var B = [], i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charCodeAt(i);
      if (ch < 0x80) B.push(ch);
      else if (ch < 0x800) B.push(0xC0 | (ch >> 6), 0x80 | (ch & 0x3F));
      else B.push(0xE0 | (ch >> 12), 0x80 | ((ch >> 6) & 0x3F), 0x80 | (ch & 0x3F));
    }
    var r = '';
    for (i = 0; i < B.length; i += 3) {
      var b0 = B[i], b1 = B[i + 1], b2 = B[i + 2];
      r += C.charAt(b0 >> 2);
      r += C.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : (b1 >> 4)));
      r += (b1 === undefined) ? '=' : C.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : (b2 >> 6)));
      r += (b2 === undefined) ? '=' : C.charAt(b2 & 63);
    }
    return r;
  }

  // ---------- 处理 edges 数组 ----------
  function fixEdges(holder) {
    if (!holder || typeof holder !== 'object') return;
    var edges = holder.edges;
    if (!Array.isArray(edges) || edges.length === 0) return;
    var kept = [], removed = 0;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var node = (e && typeof e === 'object') ? e.node : null;
      if (isAdNode(node)) { removed++; continue; }
      kept.push(e);
    }
    if (removed === 0) return;
    holder.edges = kept;
    changed = true;
    // 分页游标修正: 末条边被剔除时, endCursor 需指向新的末条边
    if (kept.length > 0 && holder.pageInfo && typeof holder.pageInfo === 'object'
        && holder.pageInfo.endCursor !== undefined) {
      var last = kept[kept.length - 1];
      var gid = (last && last.node) ? last.node.groupId : null;
      if (gid) holder.pageInfo.endCursor = b64(String(gid));
    }
  }

  // ---------- 递归遍历: 广告边 + NSFW 标记 ----------
  function walk(v, d) {
    if (!v || typeof v !== 'object' || d > MAX_DEPTH) return;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) walk(v[i], d + 1);
      return;
    }
    if (NSFW === 'Nsfw') {
      if (v.isNsfw === true) { v.isNsfw = false; changed = true; }
      if (v.isNsfwMediaBlocked === true) { v.isNsfwMediaBlocked = false; changed = true; }
      if (v.isNsfwContentShown === false) { v.isNsfwContentShown = true; changed = true; }
      // 评论区广告
      if (Array.isArray(v.commentsPageAds) && v.commentsPageAds.length > 0) {
        v.commentsPageAds = []; changed = true;
      }
    }
    fixEdges(v);
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k], d + 1);
    }
  }

  // ---------- 精确位置处理 ----------
  function fixArrays() {
    var data = obj.data;
    if (!data || typeof data !== 'object') return;

    // 详情数据: ProfilePost / isCreatedFromAdsUi = 广告帖
    if (Array.isArray(data.postsInfoByIds) && data.postsInfoByIds.length > 0) {
      var kept = [], n = 0;
      for (var i = 0; i < data.postsInfoByIds.length; i++) {
        var p = data.postsInfoByIds[i];
        if (p && typeof p === 'object'
            && (p.__typename === 'ProfilePost' || p.isCreatedFromAdsUi === true)) { n++; continue; }
        kept.push(p);
      }
      if (n > 0) { data.postsInfoByIds = kept; changed = true; }
    }

    // 详情页广告 (PdpCommentsAds)
    var pdp = data.postInfoById && data.postInfoById.pdpCommentsAds;
    if (pdp && Array.isArray(pdp.adPosts) && pdp.adPosts.length > 0) {
      pdp.adPosts = []; changed = true;
    }

    // 评论区广告 (老结构)
    if (data.children && Array.isArray(data.children.commentsPageAds)
        && data.children.commentsPageAds.length > 0) {
      data.children.commentsPageAds = []; changed = true;
    }
  }

  // ---------- 执行 ----------
  try {
    fixArrays();
    walk(obj, 0);
  } catch (e) {
    $done({}); return;   // fail-open
  }
  out(obj);
})();
