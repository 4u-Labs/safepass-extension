// SafePass Content Script - AutoFill Engine

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getAppPathKey(urlStr, titleStr = '', userStr = '') {
  if (urlStr) {
    try {
      const u = new URL((urlStr && urlStr.startsWith('http')) ? urlStr : 'https://' + (urlStr || ''));
      const segs = u.pathname.split('/').filter(Boolean);
      const clean = segs.filter(s => !s.match(/^(login|signin|auth|index|admin|entrar|wp-login|cadastrar|register)(\.(php|html|htm|jsp|asp|aspx))?$/i));
      if (clean.length > 0) {
        if (clean[0] === 'app' && clean.length > 1) return 'app/' + clean[1].toLowerCase();
        return clean[0].toLowerCase();
      }
    } catch(e) {}
  }

  const text = ((urlStr || '') + ' ' + (titleStr || '') + ' ' + (userStr || '')).toLowerCase();
  
  const pathMatch = text.match(/(?:\.br|\.com|\.net|\.org|\.io)?\/([a-z0-9_-]+(?:\/[a-z0-9_-]+)?)/i);
  if (pathMatch && pathMatch[1]) {
    const rawP = pathMatch[1].toLowerCase();
    const cleanP = rawP.replace(/^(login|signin|auth|index|admin|entrar|wp-login|cadastrar|register)(\.(php|html|htm|jsp|asp|aspx))?$/i, '').replace(/\/$/, '');
    if (cleanP && !cleanP.includes('.') && cleanP.length > 1) {
      if (cleanP.startsWith('app/') || !cleanP.includes('/')) return cleanP;
    }
  }

  const appHints = ['zap', 'lovechat', 'loja', 'ofertas', 'safepass', 'chat', 'bot', 'store', 'mail', 'blog'];
  for (const hint of appHints) {
    if (text.includes('(' + hint + ')') || text.includes('— ' + hint) || text.includes('- ' + hint) || text.includes('/' + hint) || text.includes(' ' + hint)) {
      return (hint === 'zap' || hint === 'lovechat') ? ('app/' + hint) : hint;
    }
  }

  return '';
}

function isDomainMatch(item, targetDomainOrUrl) {
  if (!item) return false;
  
  let targetHost = '';
  let targetPathKey = '';
  
  try {
    const tUrl = (targetDomainOrUrl && targetDomainOrUrl.startsWith('http')) ? targetDomainOrUrl : 'https://' + (targetDomainOrUrl || '');
    const pTarget = new URL(tUrl);
    targetHost = pTarget.hostname.replace(/^www\./i, '').toLowerCase();
    targetPathKey = getAppPathKey(tUrl);
  } catch(e) {
    targetHost = (targetDomainOrUrl || '').replace(/^www\./i, '').toLowerCase();
  }

  if (!targetPathKey && typeof window !== 'undefined' && window.location && window.location.href) {
    targetPathKey = getAppPathKey(window.location.href);
  }

  const itemUrl = item.url ? (item.url.startsWith('http') ? item.url : 'https://' + item.url) : '';
  let itemHost = '';
  let itemPathKey = '';
  
  if (itemUrl) {
    try {
      const pItem = new URL(itemUrl);
      itemHost = pItem.hostname.replace(/^www\./i, '').toLowerCase();
      itemPathKey = getAppPathKey(itemUrl, item.title, item.username);
    } catch(e) {
      itemHost = (item.url || '').toLowerCase();
      itemPathKey = getAppPathKey('', item.title, item.username);
    }
  } else if (item.domain) {
    itemHost = item.domain.replace(/^www\./i, '').toLowerCase();
    itemPathKey = getAppPathKey('', item.title, item.username);
  } else {
    itemPathKey = getAppPathKey('', item.title, item.username);
  }

  const isSafePassAccount = (item.title || '').toLowerCase().includes('safepass') || itemUrl.toLowerCase().includes('safepass');
  if (isSafePassAccount) {
    const curPath = (typeof window !== 'undefined' && window.location ? window.location.pathname : '').toLowerCase();
    return curPath.includes('safepass') || curPath.includes('safebox');
  }

  const hostMatches = (itemHost && targetHost) && (itemHost === targetHost || itemHost.endsWith('.' + targetHost) || targetHost.endsWith('.' + itemHost));
  
  if (hostMatches) {
    // If target is inside a specific sub-app (e.g. app/zap, loja)
    if (targetPathKey) {
      if (!itemPathKey) return false;
      const normTarget = targetPathKey.replace(/^app\//, '');
      const normItem = itemPathKey.replace(/^app\//, '');
      return normTarget === normItem || targetPathKey === itemPathKey;
    }
    
    // If target has NO specific sub-app path (root domain)
    if (!targetPathKey) {
      if (itemPathKey) return false;
      return true;
    }
  }

  return false;
}

function isExtensionValid() {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

if (isExtensionValid()) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'autofill') {
      const success = performAutoFill(request.username, request.password);
      sendResponse({ success });
    } else if (request.action === 'get_vault') {
      const vault = localStorage.getItem('safepass_encrypted_vault');
      const token = localStorage.getItem('safepass_cloud_token');
      const user = localStorage.getItem('safepass_cloud_user');
      sendResponse({ success: true, vault, token, user });
    } else if (request.action === 'direct_inject_pending') {
      if (request.item) {
        window.dispatchEvent(new CustomEvent('safepass_inject_pending', { detail: [request.item] }));
        sendResponse({ success: true });
      }
    } else if (request.action === 'direct_inject_full_vault') {
      if (request.vault_data) {
        window.dispatchEvent(new CustomEvent('safepass_inject_full_vault', { detail: { vault_data: request.vault_data } }));
        sendResponse({ success: true });
      }
    } else if (request.action === 'query_matches') {
      const domain = (request.domain || '').toLowerCase();
      const onReply = (e) => {
        window.removeEventListener('safepass_query_matches_reply', onReply);
        sendResponse({ logins: (e.detail && e.detail.logins) ? e.detail.logins : [] });
      };
      window.addEventListener('safepass_query_matches_reply', onReply);
      window.dispatchEvent(new CustomEvent('safepass_query_matches', { detail: { domain } }));
      setTimeout(() => {
        window.removeEventListener('safepass_query_matches_reply', onReply);
      }, 400);
      return true;
    }
    return true;
  });

  // Ponte em tempo real entre a página web do SafePass e a extensão
  if (window.location.href.includes('4u.ia.br/app/safepass') || window.location.href.includes('localhost:8080/app/safepass')) {
    window.addEventListener('safepass_vault_updated', () => {
      try {
        const rawVault = localStorage.getItem('safepass_encrypted_vault');
        const rawUser = localStorage.getItem('safepass_cloud_user');
        const rawToken = localStorage.getItem('safepass_cloud_token');
        if (rawVault && isExtensionValid()) {
          const parsed = JSON.parse(rawVault);
          chrome.storage.local.set({
            'safepass_encrypted_vault': rawVault,
            ...(rawUser ? { 'safepass_cloud_user': rawUser } : {}),
            ...(rawToken ? { 'safepass_cloud_token': rawToken } : {})
          });
          chrome.runtime.sendMessage({ action: 'sync_vault_from_web', vault_data: parsed });
        }
      } catch(e){}
    });
  }
}

function isElementVisible(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.type === 'hidden') return false;
  if (el.offsetParent === null) return false;
  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch(e) {
    return el.offsetParent !== null;
  }
}

function isSearchOrNonAuthField(el) {
  if (!el) return true;
  if (el.type === 'search') return true;
  if (el.getAttribute('data-1p-ignore') !== null || el.getAttribute('data-lpignore') === 'true' || el.getAttribute('data-bwignore') === 'true' || el.getAttribute('data-safepass-ignore') === 'true') return true;
  
  const attr = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
  
  const searchKeywords = /(search|busca|pesquis|filtr|filtro|query|keyword|buscar|carrinho|cart|pedido|item|produto|cliente|cupom|coupon|destaque|quantidade|preco|valor|total|obs|observacao)/i;
  return searchKeywords.test(attr);
}

let isAutoFilling = false;
let lastAutoFilledPassword = '';
let userExplicitlyTypedPassword = false;

function performAutoFill(username, password) {
  isAutoFilling = true;
  lastAutoFilledPassword = password;
  userExplicitlyTypedPassword = false;
  let filledPass = false;
  let filledUser = false;

  // Remove qualquer dropdown aberto na hora do preenchimento
  document.querySelectorAll('#__safepass_inline_dropdown').forEach(el => el.remove());

  // 1. Preencher campo de senha - APENAS se for visível!
  const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
  if (passwordInputs.length === 0) {
    // NUNCA preenche usuário em páginas sem campo de senha visível
    isAutoFilling = false;
    return false;
  }

  const passInput = passwordInputs[0];
  if (passInput && password) {
    setNativeValue(passInput, password);
    filledPass = true;
  }

  // 2. Preencher campo de usuário / email estritamente associado ao form da senha
  if (username && passInput) {
    const root = passInput.closest('form, [role="dialog"], [role="form"], .modal, .auth-box, .login-box, .card, main') || document.body;
    const candidateInputs = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])'))
      .filter(el => isElementVisible(el) && !isSearchOrNonAuthField(el));

    let userInput = candidateInputs.find(i => {
      if (i.type === 'email' || i.type === 'tel') return true;
      const attr = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.getAttribute('autocomplete') || '')).toLowerCase();
      return attr.includes('email') || attr.includes('user') || attr.includes('login') || attr.includes('usuario') || attr.includes('ident');
    });

    if (!userInput && candidateInputs.length > 0) {
      const allInRoot = Array.from(root.querySelectorAll('input'));
      const passIdx = allInRoot.indexOf(passInput);
      const beforePass = candidateInputs.filter(i => allInRoot.indexOf(i) < passIdx);
      if (beforePass.length > 0) {
        userInput = beforePass[beforePass.length - 1];
      }
    }

    if (userInput && !isSearchOrNonAuthField(userInput)) {
      setNativeValue(userInput, username);
      filledUser = true;
    }
  }

  setTimeout(() => {
    isAutoFilling = false;
  }, 400);

  return filledPass || filledUser;
}

// Disparar eventos nativos para que React, Vue e Angular detectem a alteração
function setNativeValue(element, value) {
  element.focus();
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value') ? 
                      Object.getOwnPropertyDescriptor(element, 'value').set : null;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value') ? 
                               Object.getOwnPropertyDescriptor(prototype, 'value').set : null;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

// ── 3. SINCRONIZAÇÃO AUTOMÁTICA COM O WEBAPP (APENAS NA ROTA /SAFEPASS OU /SAFEBOX) ──
const isSafePassWebPage = (window.location.pathname.includes('/safepass') || window.location.pathname.includes('/safebox'));

if (isSafePassWebPage) {
  const syncBiDirectional = () => {
    if (!isExtensionValid()) return;
    try {
      const webVault = localStorage.getItem('safepass_encrypted_vault');
      const cloudToken = localStorage.getItem('safepass_cloud_token');
      const cloudUser = localStorage.getItem('safepass_cloud_user');

      chrome.storage.local.get(['safepass_encrypted_vault', 'safepass_cloud_token', 'safepass_cloud_user'], (res) => {
        if (chrome.runtime.lastError || !isExtensionValid()) return;
        const extVault = res['safepass_encrypted_vault'];
        const extToken = res['safepass_cloud_token'];
        const extUser = res['safepass_cloud_user'];

        if (webVault && webVault !== 'null' && webVault.length > 20) {
          // WebApp tem cofre -> sincroniza para a extensão
          chrome.storage.local.set({
            'safepass_encrypted_vault': webVault,
            'safepass_cloud_token': cloudToken || extToken || '',
            'safepass_cloud_user': cloudUser || extUser || ''
          });
        } else if (extVault && extVault !== 'null' && extVault.length > 20) {
          // Extensão tem cofre, mas WebApp está vazio -> sincroniza para o WebApp!
          localStorage.setItem('safepass_encrypted_vault', extVault);
          if (extToken) localStorage.setItem('safepass_cloud_token', extToken);
          if (extUser) localStorage.setItem('safepass_cloud_user', extUser);
          window.dispatchEvent(new Event('storage'));
          if (typeof window.checkVaultStatus === 'function') {
            window.checkVaultStatus();
          }
        }
      });
    } catch(e) {}
  };

  const checkAndInjectPending = () => {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get(['safepass_pending_vault_items'], (res) => {
        if (chrome.runtime.lastError || !isExtensionValid()) return;
        const pending = res['safepass_pending_vault_items'] || [];
        if (pending.length > 0) {
          window.dispatchEvent(new CustomEvent('safepass_inject_pending', { detail: pending }));
          chrome.storage.local.set({ 'safepass_pending_vault_items': [] });
        }
      });
    } catch(e) {}
  };

  // Sincroniza ao carregar a página e em qualquer alteração de dados
  syncBiDirectional();
  checkAndInjectPending();
  const pollInterval = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(pollInterval);
      return;
    }
    checkAndInjectPending();
  }, 2000);

  window.addEventListener('storage', syncBiDirectional);
  window.addEventListener('safepass_vault_updated', syncBiDirectional);
  window.addEventListener('safepass_sync_cache', (e) => {
    if (!isExtensionValid()) return;
    try {
      if (e.detail && Array.isArray(e.detail.vault) && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ 'safepass_unlocked_vault_cache': e.detail.vault });
      }
    } catch(e) {}
  });
}

// ── 4. DETECTOR AUTOMÁTICO DE LOGIN & PROMPT PARA SALVAR SENHA ──
(function setupPasswordCapture() {
  // Ignora se estiver no próprio SafePass Web, no AuthPass ou se a página tiver data-safepass-ignore
  const isAuthPassWebPage = window.location.pathname.includes('/authpass') || window.location.pathname.includes('/2fa');
  if (isSafePassWebPage || isAuthPassWebPage || document.querySelector('[data-safepass-ignore="true"]')) {
    return;
  }

  let sessionUsername = '';
  let sessionUsernameFromAuth = false;
  let sessionPassword = '';
  let userExplicitlyTypedPassword = false;
  let activePasswordInput = null;
  let activeAuthForm = null;
  let lastCaptured = null;
  const dismissedSet = new Set();

  const NON_AUTH_REGEX = /\b(pedido|pedidos|carrinho|cart|checkout|pagar|pagamento|comprar|compra|item|itens|cabide|cabides|peca|pecas|produto|produtos|quantidade|qtd|adicionar|add|remover|excluir|delete|imprimir|print|comprovante|buscar|busca|search|filtrar|filtro|pesquisar|whatsapp|whats|zap|mensagem|msg|enviar|download|exportar|salvar cliente|novo cliente|editar cliente|cliente|clientes|salvar rascunho|rascunho|atualizar pedido|salvar pedido)\b/i;

  function shouldIgnoreCapture() {
    if (!isExtensionValid()) return true;
    if (isSafePassWebPage) return true;
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/authpass') || path.includes('/2fa')) return true;
    if (document.querySelector('[data-safepass-ignore="true"]')) return true;
    return false;
  }

  function isValidUsernameString(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim();
    if (s.length < 1 || s.length > 80) return false;
    // Rejeita datas ou valores monetários puros
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
    if (/^(r\$|usd|\$|€)\s*[\d.,]+/i.test(s)) return false;
    return true;
  }

  function isExplicitUsernameField(el) {
    if (!el || el.disabled || el.readOnly || el.type === 'hidden') return false;
    if (el.type === 'email') return true;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete === 'username' || autocomplete === 'email') return true;
    
    const attr = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-qa') || '')).toLowerCase();
    const isUserKeyword = /(?:^|[_\-.])(user|username|login|email|usuario|conta|cpf|matricula|identificador)(?:[_\-.]|$)/i.test(attr) ||
                          attr.includes('e-mail') || attr.includes('usuario') || attr.includes('login') || attr.includes('username');
    
    const isExcluded = NON_AUTH_REGEX.test(attr) || /(search|busca|cliente|customer|item|pedido|cabide|peca|produto|preco|valor|total|obs|observacao|endereco|rua|bairro|cidade|cep|desc|telefone|phone|whats)/i.test(attr);
    
    return isUserKeyword && !isExcluded;
  }

  function isPasswordField(el) {
    if (!el || el.disabled || el.readOnly || el.type === 'hidden') return false;
    if (el.type === 'password') return true;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete === 'current-password' || autocomplete === 'new-password') return true;
    const attr = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
    return /(?:^|[_\-.])(password|passwd|senha|pass_hash|user_pass)(?:[_\-.]|$)/i.test(attr) && el.tagName === 'INPUT' && (el.type === 'text' || !el.type);
  }

  function isNonAuthButton(btn) {
    if (!btn) return false;
    const text = ((btn.innerText || '') + ' ' + (btn.id || '') + ' ' + (btn.className || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('data-action') || '')).toLowerCase();
    return NON_AUTH_REGEX.test(text);
  }

  function findUsernameField(form, passwordInput) {
    const root = form || (passwordInput ? passwordInput.closest('form, [role="dialog"], [role="form"], .modal, .auth-box, .login-box, .login-container') : null);
    
    if (root) {
      const inputs = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])')).filter(el => {
        if (el.offsetParent === null && el.type !== 'text' && el.type !== 'email') return false;
        if (isPasswordField(el)) return false;
        return true;
      });
      
      // 1. Busca por campos explicitamente de login / e-mail / usuário
      let explicitUser = inputs.find(i => isExplicitUsernameField(i) && i.value && isValidUsernameString(i.value));
      if (explicitUser) {
        return explicitUser.value.trim();
      }

      // 2. Busca por qualquer input que contenha um e-mail válido
      let emailInput = inputs.find(i => i.value && i.value.includes('@') && isValidUsernameString(i.value) && !NON_AUTH_REGEX.test(i.name || ''));
      if (emailInput) {
        return emailInput.value.trim();
      }

      // 3. Pega o primeiro input de texto do form antes da senha, se não for campo excluído
      if (passwordInput && inputs.length > 0) {
        const allInputsInRoot = Array.from(root.querySelectorAll('input'));
        const passIndex = allInputsInRoot.indexOf(passwordInput);
        const candidate = inputs.find(i => {
          const idx = allInputsInRoot.indexOf(i);
          const attr = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '')).toLowerCase();
          const isExcluded = NON_AUTH_REGEX.test(attr) || /(search|busca|cliente|customer|item|pedido|cabide|peca|produto|preco|valor|total|obs|observacao|endereco|rua|bairro|cidade|cep|desc)/i.test(attr);
          return (passIndex === -1 || idx < passIndex) && i.value && isValidUsernameString(i.value) && !isExcluded;
        });
        if (candidate) {
          return candidate.value.trim();
        }
      }
    }

    // 4. Fallback para sessão se foi digitado num campo autêntico
    if (sessionUsername && sessionUsernameFromAuth && isValidUsernameString(sessionUsername)) {
      return sessionUsername;
    }

    return 'admin';
  }

  function extractCleanServiceName(urlStr, rawTitle) {
    try {
      const u = new URL(urlStr || window.location.href);
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();

      const brandMap = {
        '4u.ia.br': '4u.ia.br',
        'paramountplus.com': 'Paramount+',
        'proton.me': 'Proton Mail',
        'protonmail.com': 'Proton Mail',
        'disneyplus.com': 'Disney+',
        'max.com': 'Max (HBO)',
        'hbomax.com': 'Max (HBO)',
        'primevideo.com': 'Prime Video',
        'globoplay.globo.com': 'Globoplay',
        'starplus.com': 'Star+',
        'facebook.com': 'Facebook',
        'instagram.com': 'Instagram',
        'google.com': 'Google',
        'accounts.google.com': 'Google',
        'github.com': 'GitHub',
        'gitlab.com': 'GitLab',
        'netflix.com': 'Netflix',
        'twitter.com': 'X (Twitter)',
        'x.com': 'X (Twitter)',
        'amazon.com': 'Amazon',
        'amazon.com.br': 'Amazon',
        'mercadolivre.com.br': 'Mercado Livre',
        'mercadolibre.com': 'Mercado Libre',
        'hostinger.com': 'Hostinger',
        'hostinger.com.br': 'Hostinger',
        'youtube.com': 'YouTube',
        'linkedin.com': 'LinkedIn',
        'microsoft.com': 'Microsoft',
        'live.com': 'Microsoft',
        'outlook.com': 'Outlook',
        'spotify.com': 'Spotify',
        'apple.com': 'Apple',
        'icloud.com': 'iCloud',
        'nubank.com.br': 'Nubank',
        'inter.co': 'Banco Inter',
        'itau.com.br': 'Itaú',
        'bradesco.com.br': 'Bradesco',
        'santander.com.br': 'Santander',
        'caixa.gov.br': 'Caixa',
        'gov.br': 'Gov.br',
        'globo.com': 'Globo',
        'discord.com': 'Discord',
        'tiktok.com': 'TikTok',
        'twitch.tv': 'Twitch',
        'reddit.com': 'Reddit',
        'chatgpt.com': 'ChatGPT',
        'openai.com': 'OpenAI',
        'notion.so': 'Notion',
        'slack.com': 'Slack',
        'trello.com': 'Trello',
        'dropbox.com': 'Dropbox'
      };

      for (const [domain, brand] of Object.entries(brandMap)) {
        if (host === domain || host.endsWith('.' + domain)) {
          return brand;
        }
      }

      if (rawTitle && rawTitle.trim()) {
        const parts = rawTitle.split(/[|\-—•:]/).map(p => p.trim()).filter(Boolean);
        for (const part of [...parts.slice(-1), ...parts.slice(0, 1)]) {
          const lower = part.toLowerCase();
          if (part.length >= 3 && part.length <= 30 && 
              !lower.includes('login') && !lower.includes('entrar') && 
              !lower.includes('sign in') && !lower.includes('iniciar sessão') &&
              !lower.includes('acesso')) {
            return part;
          }
        }
      }

      // Descarta subdomínios genéricos como account, auth, login, id, etc.
      const genericSubs = new Set(['account', 'accounts', 'auth', 'login', 'sso', 'id', 'my', 'myaccount', 'secure', 'portal', 'web', 'mail', 'admin', 'api', 'identity', 'connect', 'signin', 'oauth', 'm']);
      let parts = host.split('.');
      while (parts.length > 2 && genericSubs.has(parts[0])) {
        parts.shift();
      }
      const baseName = parts[0] || host.split('.')[0];
      const formattedHost = baseName.charAt(0).toUpperCase() + baseName.slice(1);

      const pathSegments = u.pathname.split('/').filter(Boolean);
      const cleanSegments = pathSegments.filter(s => !s.match(/^(login|signin|auth|index|admin|entrar|wp-login|cadastrar|register)(\.(php|html|htm|jsp|asp|aspx))?$/i));
      const subApp = cleanSegments.length > 0 ? (cleanSegments[0] === 'app' && cleanSegments[1] ? cleanSegments[1] : cleanSegments[0]) : '';

      if (subApp) {
        const formattedSubApp = subApp.charAt(0).toUpperCase() + subApp.slice(1);
        return `${formattedHost} — ${formattedSubApp}`;
      }

      return formattedHost;
    } catch(e) {
      return 'Login Web';
    }
  }

  function isCurrentSiteDismissed() {
    return false;
  }

  // 1. Monitora digitação, colagem e alterações estritamente em campos de credenciais
  ['input', 'change', 'paste', 'keyup'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      if (isAutoFilling) return;
      const target = e.target;
      if (!target) return;

      if (isPasswordField(target)) {
        if (target.value && target.value.length >= 2) {
          if (!lastAutoFilledPassword || target.value !== lastAutoFilledPassword) {
            userExplicitlyTypedPassword = true;
          }
          sessionPassword = target.value;
          activePasswordInput = target;
          activeAuthForm = target.closest('form, [role="dialog"], [role="form"], .modal, .auth-box, .login-box, .card, main') || null;
          dismissedSet.clear();
          try {
            sessionStorage.removeItem('safepass_dismissed_' + window.location.hostname);
          } catch(e) {}
        }
      } else if (isExplicitUsernameField(target)) {
        const val = (target.value || '').trim();
        if (val.length >= 1 && isValidUsernameString(val)) {
          sessionUsername = val;
          sessionUsernameFromAuth = true;
        }
      }
    }, true);
  });

  // 2. Ao sair do campo de senha (blur) ou clicar, garante os valores na sessão
  ['blur', 'focusout', 'pointerdown', 'mousedown'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      const target = e.target;
      if (target && isPasswordField(target) && target.value) {
        sessionPassword = target.value;
        activePasswordInput = target;
      }
    }, true);
  });

  function triggerCapture(form, passwordInput, directPassVal) {
    if (shouldIgnoreCapture()) return;
    let passVal = (directPassVal || (passwordInput && passwordInput.value) || sessionPassword || '').trim();
    if (!passVal || passVal.length < 2) return;

    // Se a senha for a que acabou de ser autopreenchida e o usuário não alterou nada: não re-captura
    if (lastAutoFilledPassword && lastAutoFilledPassword === passVal && !userExplicitlyTypedPassword) {
      return;
    }
    // Não captura se o usuário nunca interagiu com um campo de senha
    if (!userExplicitlyTypedPassword && lastAutoFilledPassword === passVal) {
      return;
    }

    const username = findUsernameField(form, passwordInput) || (sessionUsernameFromAuth ? sessionUsername : '') || 'admin';
    const cleanTitle = extractCleanServiceName(window.location.href, document.title);
    const domain = window.location.hostname.replace(/^www\./i, '').toLowerCase();

    const cred = {
      id: 'item_' + Date.now(),
      type: 'login',
      title: cleanTitle || domain,
      url: window.location.href,
      domain: domain,
      username: username,
      password: passVal,
      notes: 'Salvo via extensão SafePass.',
      favorite: false,
      createdAt: Date.now(),
      isUpdate: false,
      timestamp: Date.now()
    };

    lastCaptured = cred;

    // 1. SALVAR DE FORMA TOTALMENTE SÍNCRONA NO SESSIONSTORAGE ANTES DE QUALQUER REDIRECIONAMENTO OU CALLBACK ASSÍNCRONO!
    try {
      sessionStorage.setItem('__safepass_pending_prompt', JSON.stringify(cred));
      sessionStorage.setItem('__safepass_draft_cred', JSON.stringify(cred));
    } catch(e) {}

    // 2. Salva no storage local da extensão
    if (isExtensionValid()) {
      chrome.storage.local.set({ 'safepass_pending_prompt': cred });
      try {
        chrome.runtime.sendMessage({ action: 'set_pending_prompt', data: cred });
      } catch(e) {}

      chrome.storage.local.get(['safepass_unlocked_vault_cache'], (res) => {
        if (chrome.runtime.lastError || !isExtensionValid()) return;
        const cache = res['safepass_unlocked_vault_cache'] || [];

        // 1. Verifica se já existe esta conta salva com a MESMA senha E mesmo usuário para este app/URL
        const exactAccountMatch = cache.find(item => {
          const uMatch = (item.username || '').trim().toLowerCase() === (username || '').trim().toLowerCase();
          return isDomainMatch(item, window.location.href) && uMatch && item.password === passVal;
        });

        if (exactAccountMatch) {
          // A conta com esse usuário e senha já está 100% atualizada no cofre!
          lastCaptured = null;
          sessionPassword = '';
          userExplicitlyTypedPassword = false;
          try {
            sessionStorage.removeItem('__safepass_pending_prompt');
            sessionStorage.removeItem('__safepass_draft_cred');
          } catch(e) {}
          chrome.storage.local.remove('safepass_pending_prompt');
          return;
        }

        // 2. Procura se já existe credencial para este usuário neste app (Atualização vs Novo)
        const existingUserMatch = cache.find(item => {
          const uMatch = (item.username || '').trim().toLowerCase() === (username || '').trim().toLowerCase();
          return uMatch && isDomainMatch(item, window.location.href);
        });

        if (existingUserMatch) {
          cred.isUpdate = true;
          cred.id = existingUserMatch.id;
          cred.title = existingUserMatch.title || cred.title;
          try {
            sessionStorage.setItem('__safepass_pending_prompt', JSON.stringify(cred));
          } catch(e) {}
          chrome.storage.local.set({ 'safepass_pending_prompt': cred });
        }

        // Exibe o prompt flutuante na tela
        showSavePasswordPrompt(cred);
      });
    } else {
      showSavePasswordPrompt(cred);
    }
  }

  // 3. Escuta submit de formulários com campo de senha autêntico
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || !form.querySelector) return;
    const pass = form.querySelector('input[type="password"]') || (activePasswordInput && form.contains(activePasswordInput) ? activePasswordInput : null);
    if (!pass) return;

    const passVal = (pass.value || '').trim();
    if (passVal && passVal.length >= 2 && userExplicitlyTypedPassword) {
      triggerCapture(form, pass, passVal);
    }
  }, true);

  // 4. Escuta cliques em botões de ação/login
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, input[type="submit"], input[type="button"], a, [role="button"], div[onclick], div[role="button"]');
    if (!btn) return;

    const btnText = ((btn.innerText || '') + ' ' + (btn.id || '') + ' ' + (btn.className || '') + ' ' + (btn.getAttribute('type') || '')).toLowerCase();
    
    // Se for botão de Logout / Cancelar / Fechar, limpa qualquer prompt e ignora
    const isCancelOrLogout = /sair|logout|log out|sign ?out|desconectar|encerrar sess[aã]o|deslogar|cancelar|cancel|fechar|close/i.test(btnText);
    if (isCancelOrLogout) {
      userExplicitlyTypedPassword = false;
      sessionPassword = '';
      sessionUsername = '';
      sessionUsernameFromAuth = false;
      activePasswordInput = null;
      activeAuthForm = null;
      lastCaptured = null;
      try {
        sessionStorage.removeItem('__safepass_pending_prompt');
        sessionStorage.removeItem('__safepass_draft_cred');
      } catch(e) {}
      if (isExtensionValid()) {
        chrome.storage.local.remove('safepass_pending_prompt');
        chrome.runtime.sendMessage({ action: 'clear_pending_prompt' }).catch(()=>{});
      }
      return;
    }

    // Se for botão de pedido, carrinho, busca, item, lavanderia, etc -> IGNORA TOTALMENTE!
    if (isNonAuthButton(btn)) {
      return;
    }

    // Só prossegue se o usuário digitou uma senha explicitamente nesta página
    if (!userExplicitlyTypedPassword) {
      return;
    }

    // Procura o campo de senha no form ou container exclusivo do botão
    const form = btn.closest('form');
    let pass = form ? form.querySelector('input[type="password"]') : null;
    
    if (!pass) {
      const container = btn.closest('[role="dialog"], [role="form"], .modal, .auth-box, .login-box, .login-container');
      if (container) {
        pass = container.querySelector('input[type="password"]');
      }
    }

    if (!pass && activeAuthForm && (form === activeAuthForm || activeAuthForm.contains(btn))) {
      pass = activePasswordInput;
    }

    if (!pass) return; // NUNCA captura de botões que não pertencem ao formulário de autenticação

    const passVal = (pass.value || sessionPassword || '').trim();
    if (!passVal || passVal.length < 2) return;

    triggerCapture(form || (pass && pass.closest ? pass.closest('form') : null), pass, passVal);
  }, true);

  // 5. Escuta tecla Enter nos inputs de login
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = e.target;
      if (!target) return;
      if (!userExplicitlyTypedPassword) return;

      const form = target.closest('form');
      let pass = form ? form.querySelector('input[type="password"]') : null;
      if (!pass && isPasswordField(target)) pass = target;
      if (!pass && activeAuthForm && (form === activeAuthForm || activeAuthForm.contains(target))) {
        pass = activePasswordInput;
      }
      
      if (!pass) return;

      const passVal = (pass.value || sessionPassword || '').trim();
      if (passVal && passVal.length >= 2) {
        triggerCapture(form || (pass && pass.closest ? pass.closest('form') : null), pass, passVal);
      }
    }
  }, true);

  // 6. Salva antes de descarregar a página caso haja redirecionamento de login legítimo
  window.addEventListener('beforeunload', () => {
    if (userExplicitlyTypedPassword && sessionPassword && sessionPassword.length >= 2 && lastCaptured) {
      try {
        sessionStorage.setItem('__safepass_pending_prompt', JSON.stringify(lastCaptured));
        sessionStorage.setItem('__safepass_draft_cred', JSON.stringify(lastCaptured));
      } catch(e) {}
      if (isExtensionValid()) {
        chrome.storage.local.set({ 'safepass_pending_prompt': lastCaptured });
      }
    }
  });

  // 7. Verifica se há prompt pendente após redirecionamento de login (sessionStorage + storage local + background)
  function checkPendingPromptOnPageLoad() {
    if (!isExtensionValid()) return;
    if (shouldIgnoreCapture()) return;

    let sessionPending = null;
    try {
      const raw = sessionStorage.getItem('__safepass_pending_prompt') || sessionStorage.getItem('__safepass_draft_cred');
      if (raw) sessionPending = JSON.parse(raw);
    } catch(e) {}

    chrome.storage.local.get(['safepass_pending_prompt', 'safepass_unlocked_vault_cache'], (res) => {
      if (chrome.runtime.lastError || !isExtensionValid()) return;
      const p = sessionPending || res['safepass_pending_prompt'];
      const cache = res['safepass_unlocked_vault_cache'] || [];

      if (p && p.password && (Date.now() - (p.timestamp || 0) < 90000)) {
        const curDomain = window.location.hostname.replace(/^www\./i, '').toLowerCase();
        const pDomain = (p.domain || '').replace(/^www\./i, '').toLowerCase();

        if (curDomain && pDomain && (curDomain.includes(pDomain) || pDomain.includes(curDomain))) {
          // 1. Verifica no cache se o item já está salvo com a mesma senha e usuário para este app/URL
          const exactMatch = cache.find(item => {
            const uMatch = (item.username || '').trim().toLowerCase() === (p.username || '').trim().toLowerCase();
            return isDomainMatch(item, p.url || window.location.href) && uMatch && item.password === p.password;
          });

          if (exactMatch) {
            try {
              sessionStorage.removeItem('__safepass_pending_prompt');
              sessionStorage.removeItem('__safepass_draft_cred');
            } catch(e) {}
            chrome.storage.local.remove('safepass_pending_prompt');
            return;
          }

          // Verifica se é atualização
          const existingUserMatch = cache.find(item => {
            const uMatch = (item.username || '').trim().toLowerCase() === (p.username || '').trim().toLowerCase();
            return uMatch && isDomainMatch(item, p.url || window.location.href);
          });

          p.isUpdate = !!existingUserMatch;
          if (existingUserMatch) {
            p.id = existingUserMatch.id;
            p.title = existingUserMatch.title || p.title;
          }

          if (!dismissedSet.has(p.password)) {
            showSavePasswordPrompt(p);
          }
        }
      }
    });
  }

  // Executa checagem de prompt pendente nos momentos adequados
  setTimeout(checkPendingPromptOnPageLoad, 400);
  window.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingPromptOnPageLoad, 300));
  window.addEventListener('load', () => setTimeout(checkPendingPromptOnPageLoad, 300));
  window.addEventListener('pageshow', () => setTimeout(checkPendingPromptOnPageLoad, 300));
  window.addEventListener('popstate', () => setTimeout(checkPendingPromptOnPageLoad, 300));
  window.addEventListener('hashchange', () => setTimeout(checkPendingPromptOnPageLoad, 300));

  // Renderiza o Banner Flutuante de Salvar Senha
  function showSavePasswordPrompt(data) {
    if (!data || !data.password || isCurrentSiteDismissed()) return;

    // Remove qualquer prompt anterior para atualizar com dados novos
    const existing = document.getElementById('__safepass_save_container');
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = '__safepass_save_container';
    host.style.cssText = 'position: fixed !important; top: 20px !important; right: 20px !important; z-index: 2147483647 !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; pointer-events: auto !important;';
    
    const shadow = host.attachShadow({ mode: 'open' });
    
    shadow.innerHTML = `
      <style>
        .safepass-prompt-box {
          background: #0d1322;
          border: 1.5px solid rgba(109, 74, 255, 0.6);
          border-radius: 14px;
          padding: 16px 18px;
          width: 310px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.85), 0 0 25px rgba(109, 74, 255, 0.4);
          color: #f8fafc;
          box-sizing: border-box;
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideIn {
          from { transform: translateY(-30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 800;
          color: #fff;
        }
        .brand span { color: #6d4aff; }
        .close-btn {
          background: none;
          border: none;
          color: #64748b;
          font-size: 20px;
          cursor: pointer;
          line-height: 1;
          padding: 2px;
          transition: color 0.15s;
        }
        .close-btn:hover { color: #f43f5e; }
        .desc {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 12px;
          line-height: 1.4;
        }
        .info-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 8px 12px;
          margin-bottom: 14px;
          font-size: 12px;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        .btn {
          flex: 1;
          height: 36px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .btn-save {
          background: linear-gradient(135deg, #6d4aff 0%, #4f2ce0 100%);
          border: none;
          color: #fff;
          box-shadow: 0 4px 14px rgba(109, 74, 255, 0.4);
        }
        .btn-save:hover {
          filter: brightness(1.15);
          transform: translateY(-1px);
        }
        .btn-cancel {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          color: #94a3b8;
        }
        .btn-cancel:hover {
          background: rgba(255,255,255,0.12);
          color: #fff;
        }
        .input-group {
          margin-bottom: 8px;
          text-align: left;
        }
        .input-group:last-child {
          margin-bottom: 0;
        }
        .input-label {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 3px;
        }
        .prompt-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          color: #fff;
          padding: 6px 8px;
          font-size: 12px;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.2s;
        }
        .prompt-input:focus {
          border-color: #6d4aff;
        }
      </style>
      <div class="safepass-prompt-box">
        <div class="header">
          <div class="brand">
            <span>🛡️</span> Safe<span>Pass</span>
          </div>
          <button class="close-btn" id="sp-close">×</button>
        </div>
        <div class="desc">${data.isUpdate ? 'Detectamos uma nova senha para esta conta. Deseja atualizar no SafePass?' : 'Deseja salvar esta senha no seu cofre seguro?'}</div>
        <div class="info-card">
          <div class="input-group">
            <label class="input-label">Nome do Serviço / Site</label>
            <input type="text" id="sp-edit-title" class="prompt-input" value="${escapeHtml(data.title || data.domain)}">
          </div>
          <div class="input-group">
            <label class="input-label">Usuário / E-mail</label>
            <input type="text" id="sp-edit-user" class="prompt-input" value="${escapeHtml(data.username || '')}">
          </div>
          <div class="input-group">
            <label class="input-label">Senha</label>
            <div style="display:flex; gap:4px;">
              <input type="password" id="sp-edit-pass" class="prompt-input" value="${escapeHtml(data.password || '')}">
              <button type="button" id="sp-toggle-pass" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#fff; cursor:pointer; padding:0 8px;">👁️</button>
            </div>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-cancel" id="sp-cancel">Agora Não</button>
          <button class="btn btn-save" id="sp-save">${data.isUpdate ? '🔄 Atualizar Senha' : '💾 Salvar Senha'}</button>
        </div>
      </div>
    `;

    const mountRoot = document.documentElement || document.body;
    if (mountRoot) {
      mountRoot.appendChild(host);
    }

    const closePrompt = () => {
      try {
        sessionStorage.setItem('safepass_dismissed_' + window.location.hostname, 'true');
        sessionStorage.removeItem('__safepass_pending_prompt');
        sessionStorage.removeItem('__safepass_draft_cred');
      } catch(e) {}
      if (data && data.password) dismissedSet.add(data.password);
      dismissedSet.add(window.location.hostname);
      userExplicitlyTypedPassword = false;
      sessionPassword = '';
      sessionUsername = '';
      lastCaptured = null;
      try {
        if (isExtensionValid()) {
          chrome.storage.local.remove('safepass_pending_prompt');
          chrome.runtime.sendMessage({ action: 'clear_pending_prompt' }).catch(()=>{});
        }
      } catch(e) {}
      host.style.transition = 'opacity 0.2s, transform 0.2s';
      host.style.opacity = '0';
      host.style.transform = 'translateY(-20px)';
      setTimeout(() => {
        if (host && host.parentNode) host.parentNode.removeChild(host);
      }, 250);
    };

    const bindAction = (id, fn) => {
      const el = shadow.getElementById(id);
      if (!el) return;
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(e);
      };
    };

    bindAction('sp-close', closePrompt);
    bindAction('sp-cancel', closePrompt);

    bindAction('sp-toggle-pass', () => {
      const passInp = shadow.getElementById('sp-edit-pass');
      if (passInp) {
        passInp.type = passInp.type === 'password' ? 'text' : 'password';
      }
    });

    bindAction('sp-save', () => {
      const saveBtn = shadow.getElementById('sp-save');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Salvando...';
        saveBtn.style.opacity = '0.7';
      }

      const editedTitle = (shadow.getElementById('sp-edit-title') ? shadow.getElementById('sp-edit-title').value.trim() : '') || data.domain || 'Login Web';
      const editedUser = shadow.getElementById('sp-edit-user') ? shadow.getElementById('sp-edit-user').value.trim() : (data.username || '');
      const editedPass = shadow.getElementById('sp-edit-pass') ? shadow.getElementById('sp-edit-pass').value : (data.password || '');

      const toSave = {
        id: (data.id && data.id.startsWith('item_')) ? data.id : ('item_' + Date.now()),
        type: 'login',
        title: editedTitle,
        url: data.url || window.location.href,
        domain: data.domain || window.location.hostname.replace(/^www\./i, '').toLowerCase(),
        username: editedUser,
        password: editedPass,
        notes: data.notes || 'Salvo via extensão SafePass.',
        favorite: !!data.favorite,
        createdAt: data.createdAt || Date.now()
      };

      try {
        sessionStorage.setItem('safepass_dismissed_' + window.location.hostname, 'true');
        sessionStorage.removeItem('__safepass_pending_prompt');
        sessionStorage.removeItem('__safepass_draft_cred');
      } catch(e) {}
      if (editedPass) dismissedSet.add(editedPass);
      dismissedSet.add(window.location.hostname);

      try {
        if (isExtensionValid()) {
          chrome.storage.local.get(['safepass_pending_vault_items', 'safepass_unlocked_vault_cache'], (res) => {
            if (chrome.runtime.lastError) return;
            let pending = res['safepass_pending_vault_items'] || [];
            let cache = res['safepass_unlocked_vault_cache'] || [];

            pending = pending.filter(p => !(isDomainMatch(p, toSave.url || toSave.domain) && (p.username || '').trim().toLowerCase() === (toSave.username || '').trim().toLowerCase()));
            cache = cache.filter(p => !(isDomainMatch(p, toSave.url || toSave.domain) && (p.username || '').trim().toLowerCase() === (toSave.username || '').trim().toLowerCase()));

            pending.unshift(toSave);
            cache.unshift(toSave);

            chrome.storage.local.set({
              'safepass_pending_vault_items': pending,
              'safepass_unlocked_vault_cache': cache,
              'safepass_pending_prompt': null
            }, () => {
              try {
                chrome.runtime.sendMessage({ action: 'save_credential', data: toSave });
                chrome.runtime.sendMessage({ action: 'clear_pending_prompt' });
              } catch(e) {}
            });
          });
        }
      } catch(e) {}

      const box = shadow.querySelector('.safepass-prompt-box');
      if (box) {
        box.innerHTML = `
          <div style="text-align: center; padding: 14px 0; color: #10b981; font-weight: 700; font-size: 13.5px; display:flex; align-items:center; justify-content:center; gap:8px;">
            <span>✅</span> Senha salva com sucesso!
          </div>
        `;
      }
      setTimeout(closePrompt, 1200);
    });
  }
})();

// ── 5. AUTO-SUGESTÃO INTELIGENTE NOS CAMPOS DE LOGIN (COM ÍCONE INTERATIVO & AUTO-FILL) ──
(function setupInFieldAutoSuggest() {
  if (window.location.hostname.includes('4u.ia.br') && window.location.pathname.includes('safepass')) {
    return;
  }

  const attachedInputs = new WeakSet();

  function scanAndAttachInputs() {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])')).filter(el => {
      if (!isElementVisible(el)) return false;
      if (isSearchOrNonAuthField(el)) return false;
      if (el.type === 'password') return true;
      if (el.type === 'email') return true;
      const name = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
      return name.includes('user') || name.includes('login') || name.includes('email') || name.includes('usuario');
    });

    inputs.forEach(input => {
      if (attachedInputs.has(input)) return;
      attachedInputs.add(input);
      bindInputAutoSuggest(input);
      attachFieldIcon(input);
    });

    // Auto-preenchimento inteligente se houver credencial salva e campo de senha vazio
    tryAutoFillOnLoad();
  }

  function tryAutoFillOnLoad() {
    if (!isExtensionValid()) return;
    const domain = window.location.hostname.replace(/^www\./i, '').toLowerCase();

    chrome.storage.local.get(['safepass_unlocked_vault_cache'], (res) => {
      if (chrome.runtime.lastError || !isExtensionValid()) return;
      const cache = res['safepass_unlocked_vault_cache'] || [];
      const matches = cache.filter(item => isDomainMatch(item, window.location.href || domain));

      if (matches.length === 1) {
        const item = matches[0];
        const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
        if (passInputs.length > 0 && (!passInputs[0].value || passInputs[0].value.length === 0)) {
          performAutoFill(item.username, item.password);
        }
      }
    });
  }

  function attachFieldIcon(input) {
    if (!input || input.type !== 'password' || input.dataset.safepassIconAttached) return;
    input.dataset.safepassIconAttached = 'true';

    // Cria wrapper ou anexa ícone posicionado
    const parent = input.parentElement;
    if (!parent) return;

    const iconBtn = document.createElement('div');
    iconBtn.className = '__safepass_field_icon_btn';
    iconBtn.title = 'SafePass: Ver Senhas Salvas';
    iconBtn.style.cssText = `
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: linear-gradient(135deg, #6d4aff 0%, #a855f7 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2147483640;
      box-shadow: 0 2px 8px rgba(109, 74, 255, 0.45);
      font-size: 12px;
      user-select: none;
      transition: transform 0.15s, filter 0.15s;
    `;
    iconBtn.innerHTML = '🔑';

    iconBtn.onmouseover = () => { iconBtn.style.transform = 'translateY(-50%) scale(1.1)'; iconBtn.style.filter = 'brightness(1.2)'; };
    iconBtn.onmouseout = () => { iconBtn.style.transform = 'translateY(-50%) scale(1)'; iconBtn.style.filter = 'none'; };

    iconBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      showInlineDropdown(input);
    };

    // Garante que o container pai tenha posição relativa se não tiver
    const parentPos = window.getComputedStyle(parent).position;
    if (parentPos === 'static') {
      parent.style.position = 'relative';
    }

    parent.appendChild(iconBtn);
  }

  function bindInputAutoSuggest(input) {
    const onFocusOrClick = (e) => {
      if (!document.getElementById('__safepass_inline_dropdown')) {
        showInlineDropdown(input);
      }
    };

    input.addEventListener('focus', onFocusOrClick);
    input.addEventListener('click', onFocusOrClick);
  }

  // Remove qualquer dropdown residual em mudanças de rota no SPA (Single Page App)
  window.addEventListener('hashchange', () => {
    document.querySelectorAll('#__safepass_inline_dropdown, .__safepass_field_icon_btn').forEach(el => el.remove());
    setTimeout(scanAndAttachInputs, 300);
  });
  window.addEventListener('popstate', () => {
    document.querySelectorAll('#__safepass_inline_dropdown, .__safepass_field_icon_btn').forEach(el => el.remove());
    setTimeout(scanAndAttachInputs, 300);
  });

  function showInlineDropdown(input) {
    if (!input || !input.isConnected || !input.offsetParent) return;

    const existing = document.getElementById('__safepass_inline_dropdown');
    if (existing) {
      existing.remove();
    }

    const rect = input.getBoundingClientRect();
    const dropdownWidth = Math.min(320, Math.max(260, rect.width));
    
    // Posicionamento fixo infalível (abaixo ou acima se estiver perto da borda inferior)
    let top = rect.bottom + 6;
    if (top + 200 > window.innerHeight && rect.top > 200) {
      top = Math.max(10, rect.top - 180);
    }
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - dropdownWidth - 15));

    const dropdown = document.createElement('div');
    dropdown.id = '__safepass_inline_dropdown';

    dropdown.style.cssText = `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      width: ${dropdownWidth}px;
      background: #0d1322;
      border: 1px solid rgba(109, 74, 255, 0.45);
      box-shadow: 0 12px 35px rgba(0,0,0,0.85), 0 0 20px rgba(109, 74, 255, 0.25);
      border-radius: 10px;
      padding: 8px;
      z-index: 2147483647;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      animation: __spFadeIn 0.15s ease;
    `;

    dropdown.innerHTML = `
      <style>
        @keyframes __spFadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .__sp_drop_btn {
          width: 100%;
          padding: 7px 10px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: #e2e8f0;
          font-size: 11.5px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.15s;
          box-sizing: border-box;
        }
        .__sp_drop_btn:hover {
          background: rgba(109, 74, 255, 0.25);
          color: #fff;
        }
        .__sp_match_card {
          background: rgba(109, 74, 255, 0.16);
          border: 1px solid rgba(109, 74, 255, 0.35);
          border-radius: 8px;
          padding: 8px 10px;
          margin-bottom: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .__sp_match_card:hover {
          background: rgba(109, 74, 255, 0.35);
          border-color: #6d4aff;
          transform: translateY(-1px);
        }
      </style>
      <div style="padding: 4px 6px 6px; font-size: 10px; font-weight: 700; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
        <span>🛡️ SafePass Sugestão</span>
        <span style="color: #10b981; font-weight: 700;">● Cofre Ativo</span>
      </div>
      <div id="__sp_matches_box">
        <div style="font-size: 11px; color: #94a3b8; padding: 6px 0; text-align: center;">
          🔍 Buscando credenciais...
        </div>
      </div>
      <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 4px;">
        <button class="__sp_drop_btn" id="__sp_gen_fill">
          <span>⚡</span> Gerar Senha Forte
        </button>
        <button class="__sp_drop_btn" id="__sp_open_ext">
          <span>🔑</span> Abrir SafePass Web
        </button>
      </div>
    `;

    function renderDropdownLogins(logins) {
      if (!dropdown.parentNode) {
        const dialogParent = input.closest('dialog, [role="dialog"], .modal, .popup');
        if (dialogParent) {
          dialogParent.appendChild(dropdown);
        } else {
          document.body.appendChild(dropdown);
        }
      }

      const matchBox = dropdown.querySelector('#__sp_matches_box');
      if (!matchBox) return;

      if (logins && logins.length > 0) {
        matchBox.innerHTML = '';
        logins.forEach(item => {
          const card = document.createElement('div');
          card.className = '__sp_match_card';
          
          let displayUrl = '';
          if (item.url) {
            try {
              const u = new URL(item.url.startsWith('http') ? item.url : 'https://' + item.url);
              const host = u.hostname.replace(/^www\./i, '');
              const path = u.pathname.replace(/\/$/, '');
              displayUrl = host + (path && path !== '/' ? path : '');
            } catch(e) {
              displayUrl = item.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
            }
          } else {
            displayUrl = item.domain || window.location.hostname;
          }

          card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; color: #fff; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">
                👤 ${escapeHtml(item.username || 'Sem usuário')}
              </span>
              <span style="font-size: 10.5px; background: linear-gradient(135deg, #6d4aff, #10b981); color: #fff; padding: 3px 8px; border-radius: 4px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;">
                ⚡ Preencher
              </span>
            </div>
            <div style="font-size: 11px; color: #38bdf8; margin-top: 3px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
              <span>🌐</span>
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayUrl)}</span>
              ${(item.title && item.title !== displayUrl && !displayUrl.includes(item.title) && item.title !== item.domain) ? `<span style="color: #94a3b8; font-weight: 400; font-size: 10px; margin-left: 2px;">• ${escapeHtml(item.title)}</span>` : ''}
            </div>
          `;

          const executeFill = (ev) => {
            if (ev) {
              ev.stopPropagation();
              ev.preventDefault();
            }
            performAutoFill(item.username, item.password);
            dropdown.remove();
          };

          card.addEventListener('click', executeFill);
          card.addEventListener('pointerup', executeFill);
          matchBox.appendChild(card);
        });
      } else {
        const currentPassVal = input.value || sessionPassword || '';
        matchBox.innerHTML = `
          <div style="padding: 4px 6px 8px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.3;">
            Nenhum login salvo para <strong style="color: #fff;">${escapeHtml(domain)}</strong>
          </div>
          ${currentPassVal ? `
            <button class="__sp_drop_btn" id="__sp_save_field_btn" style="background: rgba(109, 74, 255, 0.25); color: #a78bfa; font-weight: 700; border: 1px solid rgba(109, 74, 255, 0.4); margin-bottom: 6px;">
              <span>💾</span> Salvar Senha Digitada
            </button>
          ` : ''}
        `;

        const saveFieldBtn = matchBox.querySelector('#__sp_save_field_btn');
        if (saveFieldBtn) {
          saveFieldBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            dropdown.remove();
            const passVal = input.value || '';
            const cred = {
              id: 'item_' + Date.now(),
              type: 'login',
              title: window.location.hostname,
              url: window.location.href,
              domain: domain,
              username: 'admin',
              password: passVal,
              notes: 'Salvo via extensão SafePass.',
              favorite: false,
              createdAt: Date.now()
            };
            if (isExtensionValid()) {
              chrome.runtime.sendMessage({ action: 'save_credential', data: cred });
            }
          };
        }
      }
    }

    // Consulta senhas correspondentes ao domínio atual
    const domain = window.location.hostname.replace(/^www\./i, '').toLowerCase();
    const currentUrl = window.location.href;
    if (isExtensionValid()) {
      chrome.storage.local.get(['safepass_unlocked_vault_cache', 'safepass_pending_vault_items'], (res) => {
        if (chrome.runtime.lastError || !isExtensionValid()) return;
        const cache = res['safepass_unlocked_vault_cache'] || [];
        const pending = res['safepass_pending_vault_items'] || [];
        const combined = [...cache, ...pending];
        const localMatches = [];
        const added = new Set();

        combined.forEach(item => {
          if (isDomainMatch(item, currentUrl || domain)) {
            const key = (item.username || '') + '|' + (item.password || '');
            if (!added.has(key)) {
              added.add(key);
              localMatches.push(item);
            }
          }
        });

        if (localMatches.length > 0) {
          renderDropdownLogins(localMatches);
        } else {
          // Consulta background
          chrome.runtime.sendMessage({ action: 'get_matched_logins', domain: currentUrl || domain }, (bRes) => {
            if (chrome.runtime.lastError || !isExtensionValid()) return;
            const logins = (bRes && bRes.logins) ? bRes.logins : [];
            renderDropdownLogins(logins);
          });
        }
      });
    }

    // Fechar ao clicar fora (sem sofrer com eventos de blur causados pelo Chrome)
    const onDocClick = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== input) {
        dropdown.remove();
        document.removeEventListener('pointerdown', onDocClick);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', onDocClick), 50);

    // Gerar senha forte na hora
    const genBtn = dropdown.querySelector('#__sp_gen_fill');
    if (genBtn) {
      genBtn.onclick = () => {
        const strongPass = generateQuickPassword(20);
        setNativeValue(input, strongPass);
        dropdown.remove();
      };
    }

    const openExtBtn = dropdown.querySelector('#__sp_open_ext');
    if (openExtBtn) {
      openExtBtn.onclick = () => {
        window.open('https://4u.ia.br/app/safepass/', '_blank');
        dropdown.remove();
      };
    }
  }

  function generateQuickPassword(len = 20) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}';
    const array = new Uint32Array(len);
    crypto.getRandomValues(array);
    let pass = '';
    for (let i = 0; i < len; i++) {
      pass += chars[array[i] % chars.length];
    }
    return pass;
  }

  // Monitora a página para novos inputs dinâmicos
  const scanInterval = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(scanInterval);
      return;
    }
    scanAndAttachInputs();
  }, 1500);
  scanAndAttachInputs();
  const observer = new MutationObserver(() => {
    if (isExtensionValid()) scanAndAttachInputs();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
