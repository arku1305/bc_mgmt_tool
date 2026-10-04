(function(root) {
  const api = {
    async request(user) {
      const url = (root.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app') + '/api/registration-admin?scope=access';
      let token = await user.getIdToken();
      const send = () => fetch(url, { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
      let response = await send();
      // 憑證失效只重試一次；403 是實際權限拒絕，不繞過。
      if (response.status === 401) {
        token = await user.getIdToken(true);
        response = await send();
      }
      return { token, response };
    },
    errorMessage(status) {
      if (status === 401) return '登入已失效，請重新使用 Google 帳號登入。';
      if (status === 403) return '這個 Google 帳號尚未獲得團長權限，請切換至已核准帳號。';
      return '無法確認團長權限，請稍後重試。';
    }
  };
  root.RankingAuthAccess = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
