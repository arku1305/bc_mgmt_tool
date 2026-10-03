(function() {
  const identity = new URLSearchParams(location.search).get('as') || 'leader';
  const user = { uid: 'demo-' + identity, getIdToken: async () => identity };
  window.firebase = { auth: () => ({ currentUser: user, onAuthStateChanged(fn) { queueMicrotask(() => fn(user)); return () => {}; }, signOut: async () => { location.search = '?registration&as=leader'; } }) };
  window.ROSTER_API_URL = location.origin;
  window.SIGNUP_PAGE_URL = location.origin + '/?event=';
  window.__TWEAKS__ = { theme: 'minimal', accent: '#8ff3b5' };
})();
