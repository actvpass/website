/* dc-lite: tiny runtime for ACTVPASS pages.
   Renders a <template> with {{bindings}}, <sc-if>, <sc-for> from a component's renderVals(),
   and patches the DOM in place with morphdom so transitions and animations keep working. */
(function () {
  'use strict';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u) {
    var patch = typeof u === 'function' ? u(this.state, this.props) : u;
    if (!patch) return;
    this.state = Object.assign({}, this.state, patch);
    if (this.__schedule) this.__schedule();
  };
  window.DCLogic = DCLogic;

  var RE = /\{\{([^}]+)\}\}/g;
  function lookup(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(RE, function (_, e) { var v = lookup(scope, e); return v == null ? '' : String(v); });
  }
  function single(str) { var m = /^\s*\{\{([^}]+)\}\}\s*$/.exec(str || ''); return m ? m[1] : null; }

  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'change', onmouseenter: 'enter', onmouseleave: 'leave', onfocus: 'focus', onmousemove: 'move' };
  var BOOL = { disabled: 1, checked: 1, selected: 1, hidden: 1, readonly: 1, required: 1 };

  function mount(root, tpl, Comp, props) {
    var inst = new Comp(props);
    var handlers = {}, hid = 0, queued = false;

    function build(node, scope, out) {
      var kids = node.childNodes;
      for (var k = 0; k < kids.length; k++) {
        var c = kids[k];
        if (c.nodeType === 3) { out.appendChild(document.createTextNode(c.nodeValue.indexOf('{{') > -1 ? interp(c.nodeValue, scope) : c.nodeValue)); continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.localName;
        if (tag === 'sc-if') { var ce = single(c.getAttribute('value')); if (ce && lookup(scope, ce)) build(c, scope, out); continue; }
        if (tag === 'sc-for') {
          var le = single(c.getAttribute('list')), as = c.getAttribute('as') || 'item', list = le ? lookup(scope, le) : null;
          if (Array.isArray(list)) list.forEach(function (it, i) { var s = Object.create(scope); s[as] = it; s.$index = i; build(c, s, out); });
          continue;
        }
        var el = document.createElementNS(c.namespaceURI, c.localName);
        for (var a = 0; a < c.attributes.length; a++) {
          var at = c.attributes[a], name = at.name, val = at.value, lname = name.toLowerCase();
          if (lname.indexOf('hint-') === 0) continue;
          if (EVENTS[lname]) {
            var he = single(val), fn = he ? lookup(scope, he) : null;
            if (typeof fn === 'function') { var id = 'h' + (hid++); handlers[id] = fn; el.setAttribute('data-dc-' + EVENTS[lname], id); }
            continue;
          }
          if (val.indexOf('{{') > -1) {
            var se = single(val);
            if (se && BOOL[lname]) { if (lookup(scope, se)) el.setAttribute(name, ''); continue; }
            val = interp(val, scope);
          }
          el.setAttribute(name, val);
        }
        build(c.localName === 'template' ? c.content : c, scope, el);
        out.appendChild(el);
      }
    }

    function render() {
      queued = false; handlers = {}; hid = 0;
      var vals = inst.renderVals() || {};
      var next = root.cloneNode(false);
      build(tpl.content, vals, next);
      window.morphdom(root, next, {
        childrenOnly: true,
        onBeforeElUpdated: function (from, to) {
          var t = from.tagName;
          if ((t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') && !to.hasAttribute('value')) {
            for (var i = 0; i < to.attributes.length; i++) { var x = to.attributes[i]; if (from.getAttribute(x.name) !== x.value) from.setAttribute(x.name, x.value); }
            return false;
          }
          return true;
        }
      });
    }
    inst.__schedule = function () { if (!queued) { queued = true; requestAnimationFrame(render); } };

    function fire(el, kind, e) {
      var id = el.getAttribute('data-dc-' + kind), fn = id && handlers[id];
      if (!fn) return;
      fn({ nativeEvent: e, target: e.target, currentTarget: el, clientX: e.clientX, clientY: e.clientY, key: e.key, preventDefault: function () { e.preventDefault(); }, stopPropagation: function () { e.stopPropagation(); } });
    }
    function closest(t, kind) { while (t && t !== root.parentNode) { if (t.nodeType === 1 && t.hasAttribute('data-dc-' + kind)) return t; t = t.parentNode; } return null; }

    root.addEventListener('click', function (e) { var el = closest(e.target, 'click'); if (el) fire(el, 'click', e); });
    root.addEventListener('input', function (e) { var el = closest(e.target, 'change'); if (el && el.tagName !== 'SELECT') fire(el, 'change', e); });
    root.addEventListener('change', function (e) { var el = closest(e.target, 'change'); if (el && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio')) fire(el, 'change', e); });
    root.addEventListener('focusin', function (e) { var el = closest(e.target, 'focus'); if (el) fire(el, 'focus', e); });
    root.addEventListener('mousemove', function (e) { var el = closest(e.target, 'move'); if (el) fire(el, 'move', e); });
    root.addEventListener('mouseover', function (e) {
      var t = e.target;
      while (t && t !== root.parentNode) {
        if (t.nodeType === 1 && t.hasAttribute('data-dc-enter') && !(e.relatedTarget && t.contains(e.relatedTarget))) fire(t, 'enter', e);
        t = t.parentNode;
      }
    });
    root.addEventListener('mouseout', function (e) {
      var t = e.target;
      while (t && t !== root.parentNode) {
        if (t.nodeType === 1 && t.hasAttribute('data-dc-leave') && !(e.relatedTarget && t.contains(e.relatedTarget))) fire(t, 'leave', e);
        t = t.parentNode;
      }
    });

    render();
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
    return inst;
  }

  window.dcLite = { mount: mount };
})();
