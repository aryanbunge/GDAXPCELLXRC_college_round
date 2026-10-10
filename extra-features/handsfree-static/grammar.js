// Voice command grammar. Shared by the content script and the setup/diagnostics page.
(function (root) {
  const W = { one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  const num = (w) => parseInt(w, 10) || W[w] || 0;
  const norm = (t) => String(t || '').toLowerCase().replace(/[,!?'"]/g, '').replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
  function parse(text) {
    let t = norm(text).replace(/^(hey |ok )?hands ?free /, '');
    let m;
    if ((m = t.match(/^(?:click|select|open|press|tap) (?:number )?(\w+)$/))) { const n = num(m[1]); if (n) return { intent: 'clicknum', arg: n }; }
    if (/^(click|click this|select|tap|click here)$/.test(t)) return { intent: 'click' };
    if (/^double click$/.test(t)) return { intent: 'dblclick' };
    if (/^right click$/.test(t)) return { intent: 'rightclick' };
    if (/^show (the )?(numbers|labels)$/.test(t)) return { intent: 'shownum' };
    if (/^(hide|clear|remove) (the )?(numbers|labels)$/.test(t)) return { intent: 'hidenum' };
    if (/^scroll down$/.test(t)) return { intent: 'scrolldown' };
    if (/^scroll up$/.test(t)) return { intent: 'scrollup' };
    if (/^(go to |scroll to )?top$/.test(t)) return { intent: 'top' };
    if (/^(go to |scroll to )?bottom$/.test(t)) return { intent: 'bottom' };
    if (/^(go )?back$/.test(t)) return { intent: 'back' };
    if (/^(go )?forward$/.test(t)) return { intent: 'forward' };
    if (/^(refresh|reload)( page)?$/.test(t)) return { intent: 'refresh' };
    if (/^new tab$/.test(t)) return { intent: 'newtab' };
    if (/^close tab$/.test(t)) return { intent: 'closetab' };
    if (/^next tab$/.test(t)) return { intent: 'nexttab' };
    if (/^(previous|last) tab$/.test(t)) return { intent: 'prevtab' };
    if ((m = t.match(/^go to (.+)$/))) return { intent: 'goto', arg: m[1].replace(/\s+dot\s+/g, '.') };
    if ((m = t.match(/^search (?:for )?(.+)$/))) return { intent: 'search', arg: m[1] };
    if ((m = t.match(/^(?:type|write) (.+)$/))) return { intent: 'typetext', arg: m[1] };
    if (/^(type|dictate|start typing|start dictation)$/.test(t)) return { intent: 'type' };
    if (/^stop( dictation| typing| listening)?$/.test(t)) return { intent: 'stop' };
    if (/^(skip|skip dot|next dot)$/.test(t)) return { intent: 'skip' };
    if (/^calibrate$/.test(t)) return { intent: 'calibrate' };
    if (/^re ?center$/.test(t)) return { intent: 'recenter' };
    if (/^pause( tracking)?$/.test(t)) return { intent: 'pause' };
    if (/^(resume|start)( tracking)?$/.test(t)) return { intent: 'resume' };
    if (/^dwell off$/.test(t)) return { intent: 'dwelloff' };
    if (/^dwell on$/.test(t)) return { intent: 'dwellon' };
    return null;
  }
  // Try the best transcript first, then the alternatives the recogniser offered.
  function parseAny(texts) {
    for (const x of texts || []) { const r = parse(x); if (r) return { ...r, heard: x }; }
    return null;
  }
  root.HF = { parse, parseAny, num, norm };
})(typeof window !== 'undefined' ? window : globalThis);
