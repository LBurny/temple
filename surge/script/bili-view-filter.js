// Bilibili View/View 广告卡「字节级」安全过滤
// 不做 schema 解析/重编码：只删掉目标字段，其余字节原样透传（未知字段、字段顺序全部保留）
// 命中 ViewReply.tab[*].tab_module[introduction].modules[]：
//   - type ∈ {18,29,37,55,63} 的模块整体删除
//   - type == 3 (UGC_HEADLINE) 删除 headLine.label
//   - type == 28 (RELATED_RECOMMEND) 删除广告卡（relate_card_type ∈ {4,5,6,7,11} / 有 cm_stock / basic_info 带 uniqueId）
(function () {
  var MOD_DROP = [18, 29, 37, 55, 63];
  var CARD_DROP = [4, 5, 6, 7, 11];

  function rv(b, p, end) {
    var v = 0, sh = 0, x, n = 0;
    do {
      if (p >= end) throw new Error('eof');
      x = b[p++]; n++;
      v += (x & 0x7f) * Math.pow(2, sh);
      sh += 7;
      if (n > 8) throw new Error('varint overflow');
    } while (x & 0x80);
    return [v, p];
  }

  function fields(b, s, e) {
    var out = [], p = s;
    while (p < e) {
      var hs = p, r = rv(b, p, e), key = r[0], wt = key % 8, no = Math.floor(key / 8);
      p = r[1];
      if (no === 0) throw new Error('field 0');
      var vs;
      if (wt === 0) { vs = p; p = rv(b, p, e)[1]; }
      else if (wt === 2) { r = rv(b, p, e); vs = r[1]; p = vs + r[0]; }
      else if (wt === 5) { vs = p; p += 4; }
      else if (wt === 1) { vs = p; p += 8; }
      else throw new Error('wire type ' + wt);
      if (p > e) throw new Error('overrun');
      out.push({ no: no, wt: wt, hs: hs, he: vs, vs: vs, ve: p });
    }
    if (p !== e) throw new Error('trailing');
    return out;
  }

  function cat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var o = new Uint8Array(n), p = 0;
    for (i = 0; i < parts.length; i++) { o.set(parts[i], p); p += parts[i].length; }
    return o;
  }

  function rebuild(b, fs, map) {
    var out = [], i, f, r;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      r = map ? map(f) : undefined;
      if (r === null) continue;
      out.push(r === undefined ? b.subarray(f.hs, f.ve) : r);
    }
    return cat(out);
  }

  function wv(n) {
    var o = [], x = n;
    while (x > 127) { o.push((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    o.push(x);
    return new Uint8Array(o);
  }

  // 重建「tag + 长度 + 值」：长度必须按新值重新编码
  function withValue(b, f, val) { return cat([wv((f.no << 3) | f.wt), wv(val.length), val]); }
  function varintOf(b, f) { return rv(b, f.vs, f.ve)[0]; }

  function filterCard(b, s, e) {
    var fs = fields(b, s, e), type = 0, drop = false, i, j, f, bi;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.no === 1 && f.wt === 0) type = varintOf(b, f);
      else if (f.no === 11 && f.wt === 2 && f.ve > f.vs) drop = true;
      else if (f.no === 12 && f.wt === 2) {
        bi = fields(b, f.vs, f.ve);
        for (j = 0; j < bi.length; j++) if (bi[j].no === 6 && bi[j].wt === 2 && bi[j].ve > bi[j].vs) drop = true;
      }
    }
    if (CARD_DROP.indexOf(type) >= 0) drop = true;
    return drop ? null : b.subarray(s, e);
  }

  function filterRelates(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 1 && f.wt === 2) {
        var c = filterCard(b, f.vs, f.ve);
        return c === null ? null : withValue(b, f, c);
      }
    });
  }

  function stripHeadline(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 1 && f.wt === 2) return null;
    });
  }

  function filterModule(b, s, e) {
    var fs = fields(b, s, e), type = 0, i;
    for (i = 0; i < fs.length; i++) if (fs[i].no === 1 && fs[i].wt === 0) type = varintOf(b, fs[i]);
    if (MOD_DROP.indexOf(type) >= 0) return null;
    return rebuild(b, fs, function (f) {
      if (f.no === 22 && f.wt === 2 && type === 28) return withValue(b, f, filterRelates(b, f.vs, f.ve));
      if (f.no === 5 && f.wt === 2 && type === 3) return withValue(b, f, stripHeadline(b, f.vs, f.ve));
    });
  }

  function filterIntro(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 2 && f.wt === 2) {
        var m = filterModule(b, f.vs, f.ve);
        return m === null ? null : withValue(b, f, m);
      }
    });
  }

  function filterTabModule(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 2 && f.wt === 2) return withValue(b, f, filterIntro(b, f.vs, f.ve));
    });
  }

  function filterTab(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 1 && f.wt === 2) return withValue(b, f, filterTabModule(b, f.vs, f.ve));
    });
  }

  // 入口：ViewReply
  function filterViewReply(b, s, e) {
    return rebuild(b, fields(b, s, e), function (f) {
      if (f.no === 5 && f.wt === 2) return withValue(b, f, filterTab(b, f.vs, f.ve));
    });
  }

  function run() {
    var body = $response.body;
    if (!body || body.length < 5) return $done({});
    var b = body instanceof Uint8Array ? body : new Uint8Array(body);
    var flag = b[0];
    var len = ((b[1] << 24) >>> 0) + (b[2] << 16) + (b[3] << 8) + b[4];
    if ((flag !== 0 && flag !== 1) || len !== b.length - 5) return $done({});
    var payload = b.subarray(5);
    if (flag === 1) payload = $utils.ungzip(payload);
    var out = filterViewReply(payload, 0, payload.length);
    if (!out || out.length === payload.length) return $done({});
    var res = new Uint8Array(5 + out.length);
    res[0] = 0;
    res[1] = (out.length >>> 24) & 255;
    res[2] = (out.length >>> 16) & 255;
    res[3] = (out.length >>> 8) & 255;
    res[4] = out.length & 255;
    res.set(out, 5);
    $done({ body: res });
  }

  try { run(); } catch (err) { $done({}); }
})();
