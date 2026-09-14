/* RomyLabs admin production guard — canonical admin host + legacy product-link cleanup. */
/* CC_HIDE_FIX_20260827: never hide Command Center containers by textContent. */
/* IMPERSONATION_FIX_20260829: stale browser impersonation state must never lock owner out. */
/* MEET_PUBLIC_ROUTE_FIX_20260830: public meeting/training routes must bypass admin redirect. */
/* MOBILE_ADMIN_SESSION_FIX_20260830: stale tenant/demo auth must never boot on admin host. */
/* MOBILE_ADMIN_LOGIN_RESET_V4_20260830: /login always starts with zero inherited auth. */
(function () {
  var host = window.location.hostname.toLowerCase();
  var path = window.location.pathname;
  var params = new URLSearchParams(window.location.search || '');
  var isImpersonationRoute = path === '/impersonate';
  var storedImpersonation = false;
  try { storedImpersonation = !!sessionStorage.getItem('admin_impersonation'); } catch (_) {}
  // Only the validated Jump In landing route may preserve ?imp=1. A stale
  // mobile /login?imp=1 or /crm-admin?imp=1 must never boot a tenant/demo CRM.
  var isActiveImpersonation = path === '/' && params.get('imp') === '1' && storedImpersonation;
  var publicPrefixes = ['/meet/', '/screenshare', '/screenshare-host', '/book', '/sign/', '/agreement/', '/office-sign/', '/portal/', '/clockin', '/kiosk', '/employee', '/financial-intake/', '/organizer/'];
  var isPublicRoute = publicPrefixes.some(function (prefix) {
    return prefix.endsWith('/') ? path.indexOf(prefix) === 0 : (path === prefix || path.indexOf(prefix + '/') === 0);
  });

  /* TaxRes is the CRM host. If a stale /crm-admin URL is opened there,
   * recover back to the CRM instead of sending the user to RomyLabs Admin. */
  if ((host === 'taxrescrm.app' || host === 'www.taxrescrm.app') && path.indexOf('/crm-admin') === 0) {
    window.location.replace('/');
    return;
  }

  if (host !== 'admin.romylabs.com') return;

  /* IOS_CHROME_BFCACHE_FIX_V5_20260830: Chrome on iPhone may restore a fully
   * rendered tenant/demo page from WebKit's back-forward cache without a normal
   * application boot. Force the dedicated admin control-plane route to evaluate
   * again whenever such a page is restored, except during validated Jump In. */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    var livePath = window.location.pathname;
    var liveParams = new URLSearchParams(window.location.search || '');
    var liveStoredImp = false;
    try { liveStoredImp = !!sessionStorage.getItem('admin_impersonation'); } catch (_) {}
    var liveActiveImp = livePath === '/' && liveParams.get('imp') === '1' && liveStoredImp;
    var livePublicPrefixes = ['/meet/', '/screenshare', '/screenshare-host', '/book', '/sign/', '/agreement/', '/office-sign/', '/portal/', '/clockin', '/kiosk', '/employee', '/financial-intake/', '/organizer/'];
    var livePublicRoute = livePublicPrefixes.some(function (prefix) {
      return prefix.endsWith('/') ? livePath.indexOf(prefix) === 0 : (livePath === prefix || livePath.indexOf(prefix + '/') === 0);
    });
    if (livePublicRoute || livePath === '/impersonate' || liveActiveImp) return;
    window.location.replace('/crm-admin?fresh=' + Date.now());
  });

  function storedSessionEmail(raw) {
    if (!raw) return '';
    try {
      var parsed = JSON.parse(raw);
      var direct = parsed && parsed.user && parsed.user.email ? parsed.user.email : '';
      if (direct) return String(direct).toLowerCase();
      var token = parsed && parsed.access_token ? parsed.access_token : '';
      if (!token && Array.isArray(parsed) && parsed[0] && parsed[0].access_token) token = parsed[0].access_token;
      if (token && token.split('.').length >= 2) {
        var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        var decoded = JSON.parse(atob(payload));
        return decoded && decoded.email ? String(decoded.email).toLowerCase() : '';
      }
    } catch (_) {}
    return '';
  }

  /* Public meeting/training/invite routes intentionally run on the RomyLabs host
   * without entering the authenticated control plane. Never rewrite them. */
  if (isPublicRoute) return;

  /* HARD LOGIN BOUNDARY: the dedicated RomyLabs admin login page must never
   * inherit any prior Supabase session from TaxRes, Demo, or a previous Jump In.
   * Chrome on iOS can restore stale page/session state aggressively, so do not
   * try to classify the old session here — remove every Supabase auth token
   * before React/Supabase boots. This is scoped only to admin.romylabs.com/login. */
  if (path === '/login') {
    try {
      for (var loginStorageIndex = localStorage.length - 1; loginStorageIndex >= 0; loginStorageIndex--) {
        var loginStorageKey = localStorage.key(loginStorageIndex);
        if (loginStorageKey && loginStorageKey.indexOf('sb-') === 0 && loginStorageKey.indexOf('-auth-token') !== -1) {
          localStorage.removeItem(loginStorageKey);
        }
      }
    } catch (_) {}
    try {
      for (var loginSessionIndex = sessionStorage.length - 1; loginSessionIndex >= 0; loginSessionIndex--) {
        var loginSessionKey = sessionStorage.key(loginSessionIndex);
        if (loginSessionKey && loginSessionKey.indexOf('sb-') === 0 && loginSessionKey.indexOf('-auth-token') !== -1) {
          sessionStorage.removeItem(loginSessionKey);
        }
      }
      sessionStorage.removeItem('admin_impersonation');
    } catch (_) {}
    if (params.get('imp') || params.get('switch')) {
      try { window.history.replaceState({}, '', '/login?admin=1'); } catch (_) {}
    }
  }

  /* Mobile browsers can preserve a valid TaxRes/demo Supabase session from a
   * different visit. Before React boots on the dedicated admin hostname, inspect
   * Supabase auth storage. If the stored user is explicitly a non-owner, remove
   * only that auth record and send the browser to the RomyLabs login. Never do
   * this during an intentional Jump In session. */
  if (!isImpersonationRoute && !isActiveImpersonation) {
    var ownerEmails = {
      'info@romylabs.com': true,
      'romy@romylabs.com': true,
      'romy@taxrescrm.net': true,
      'romy@taxcasereview.org': true
    };
    var removedTenantAuth = false;
    [localStorage, sessionStorage].forEach(function (store) {
      try {
        for (var storageIndex = store.length - 1; storageIndex >= 0; storageIndex--) {
          var storageKey = store.key(storageIndex);
          if (!storageKey || storageKey.indexOf('sb-') !== 0 || storageKey.indexOf('-auth-token') === -1) continue;
          var rawSession = store.getItem(storageKey);
          var storedEmail = storedSessionEmail(rawSession);
          if (storedEmail && !ownerEmails[storedEmail]) {
            store.removeItem(storageKey);
            removedTenantAuth = true;
          }
        }
      } catch (_) {}
    });
    if (removedTenantAuth) {
      try { sessionStorage.removeItem('admin_impersonation'); } catch (_) {}
      if (path !== '/login') window.location.replace('/login?admin=1');
      return;
    }
  }

  /* admin.romylabs.com is the dedicated control plane. A stale Jump In marker
   * in sessionStorage is NOT authority to remain in the CRM shell. Only the
   * validated /impersonate entry route or an explicit ?imp=1 session may do so.
   * Clear stale browser state before React boots so AdminGate cannot read it. */
  if (!isImpersonationRoute && !isActiveImpersonation) {
    try { sessionStorage.removeItem('admin_impersonation'); } catch (_) {}
  }

  if (path.indexOf('/crm-admin') !== 0 && path !== '/login' && path.indexOf('/auth/') !== 0 && !isImpersonationRoute && !isActiveImpersonation) {
    window.location.replace('/crm-admin');
    return;
  }

  var CAMVELLA_CRM = 'https://app.camvella.com';
  var ARCVENA_CRM = 'https://app.arcvena.com';

  function normalized(url) {
    try {
      var u = new URL(url, window.location.href);
      var targetHost = u.hostname.toLowerCase();
      if (targetHost === 'www.camvella.com' || targetHost === 'camvella.com' || targetHost === 'app.camvella.com') return CAMVELLA_CRM;
      if (targetHost === 'www.arcvena.com' || targetHost === 'arcvena.com' || targetHost === 'app.arcvena.com' || targetHost === 'arcvena-com.link' || targetHost === 'www.arcvena-com.link') return ARCVENA_CRM;
      return url;
    } catch (_) { return url; }
  }

  function productFromCard(el) {
    var node = el;
    while (node && node !== document.body) {
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/\bCamvella\b/i.test(text)) return 'camvella';
      if (/\bArcvena\b/i.test(text)) return 'arcvena';
      node = node.parentElement;
    }
    return null;
  }

  function crmFor(product) {
    return product === 'camvella' ? CAMVELLA_CRM : product === 'arcvena' ? ARCVENA_CRM : null;
  }

  document.addEventListener('click', function (event) {
    var clickable = event.target && event.target.closest ? event.target.closest('a,button') : null;
    if (!clickable) return;
    var href = clickable.getAttribute && clickable.getAttribute('href');
    var direct = href ? normalized(href) : href;
    var label = (clickable.textContent || '').replace(/\s+/g, ' ').trim();
    var product = productFromCard(clickable);
    var forced = crmFor(product);
    if (direct && direct !== href) {
      event.preventDefault(); event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      window.open(direct, '_blank', 'noopener,noreferrer'); return;
    }
    if (/^Open(?: CRM)?\s*→?$/i.test(label) && forced) {
      event.preventDefault(); event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      window.open(forced, '_blank', 'noopener,noreferrer');
    }
  }, true);

  /* IMPORTANT: this guard must never hide or mutate rendered Command Center
   * containers based on textContent. Product-link normalization is intentionally
   * limited to anchor hrefs only. */
  function rewriteLinks() {
    var anchors = document.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var oldHref = anchors[i].getAttribute('href');
      var newHref = normalized(oldHref);
      var product = productFromCard(anchors[i]);
      var forced = crmFor(product);
      var label = (anchors[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Open(?: CRM)?\s*→?$/i.test(label) && forced) newHref = forced;
      if (newHref && newHref !== oldHref) anchors[i].setAttribute('href', newHref);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rewriteLinks, { once: true });
  else rewriteLinks();

  var count = 0;
  var timer = window.setInterval(function () { rewriteLinks(); count += 1; if (count >= 20) window.clearInterval(timer); }, 500);
})();
