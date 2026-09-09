// SafePass Background Service Worker - 100% Standalone Engine

const STORAGE_KEY = 'safepass_encrypted_vault';
const enc = new TextEncoder();
const dec = new TextDecoder();

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptData(encrypted, key) {
  if (!encrypted || !encrypted.iv || !encrypted.data || !key) return null;
  try {
    const iv = hexToBuffer(encrypted.iv);
    const ciphertext = hexToBuffer(encrypted.data);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, ciphertext);
    return JSON.parse(dec.decode(decrypted));
  } catch (err) {
    return null;
  }
}

async function encryptData(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = enc.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    iv: bufferToHex(iv),
    data: bufferToHex(ciphertext)
  };
}

async function autoDecryptPersistentCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      STORAGE_KEY,
      'safepass_persistent_pass',
      'safepass_vault_timeout',
      'safepass_session_expires_at',
      'safepass_session_unlocked_pass'
    ], async (res) => {
      const stored = res[STORAGE_KEY];
      const persistentPass = res['safepass_persistent_pass'];
      const sessionPass = res['safepass_session_unlocked_pass'] || persistentPass;
      const sessionExpiresAt = res['safepass_session_expires_at'] || 0;
      const timeout = res['safepass_vault_timeout'] || '15min';

      const isSessionValid = (timeout === 'never') || (sessionExpiresAt && Date.now() < sessionExpiresAt);

      if (stored && sessionPass && isSessionValid) {
        try {
          const parsed = JSON.parse(stored);
          const salt = new Uint8Array(hexToBuffer(parsed.salt));
          const key = await deriveKey(sessionPass, salt);
          const test = await decryptData(parsed.verifier, key);
          if (test === 'VERIFIER_OK') {
            const vault = await decryptData(parsed.payload, key);
            chrome.storage.local.set({ 'safepass_unlocked_vault_cache': vault }, () => {
              resolve(vault);
            });
            return;
          }
        } catch(e) {}
      }
      resolve(null);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  autoDecryptPersistentCache();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    autoDecryptPersistentCache();
  });
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

// Listener para mensagens da extensão
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'save_credential') {
    const cred = request.data;
    if (!cred || !cred.password) {
      sendResponse({ success: false, error: 'Credenciais inválidas' });
      return true;
    }

    chrome.storage.local.get([
      'safepass_pending_vault_items',
      'safepass_unlocked_vault_cache',
      STORAGE_KEY,
      'safepass_session_unlocked_pass',
      'safepass_persistent_pass',
      'safepass_cloud_token',
      'safepass_cloud_user'
    ], async (res) => {
      let pending = res['safepass_pending_vault_items'] || [];
      let cache = res['safepass_unlocked_vault_cache'] || [];

      // Remove qualquer entrada anterior deste mesmo usuário/domínio
      pending = pending.filter(p => !(isDomainMatch(p, cred.url || cred.domain) && (p.username || '').trim().toLowerCase() === (cred.username || '').trim().toLowerCase()));

      const newItem = {
        id: cred.id || ('item_' + Date.now()),
        type: 'login',
        title: cred.title || cred.domain || 'Login Web',
        url: cred.url,
        domain: cred.domain || '',
        username: cred.username || '',
        password: cred.password,
        notes: cred.notes || 'Capturado automaticamente na extensão SafePass.',
        favorite: false,
        createdAt: Date.now()
      };

      pending.unshift(newItem);

      // Atualiza o cache de senhas desbloqueadas
      const cacheIdx = cache.findIndex(p => isDomainMatch(p, cred.domain || cred.url) && (p.username || '').trim().toLowerCase() === (cred.username || '').trim().toLowerCase());
      if (cacheIdx >= 0) {
        cache[cacheIdx].password = cred.password;
        cache[cacheIdx].title = cred.title || cache[cacheIdx].title;
        cache[cacheIdx].url = cred.url || cache[cacheIdx].url;
        cache[cacheIdx].updatedAt = Date.now();
      } else {
        cache.unshift(newItem);
      }

      // Re-criptografa o cofre e envia para a nuvem imediatamente se a sessão estiver ativa
      const pass = res['safepass_session_unlocked_pass'] || res['safepass_persistent_pass'];
      const stored = res[STORAGE_KEY];
      let newEncryptedVault = null;

      if (pass && stored) {
        try {
          const parsed = JSON.parse(stored);
          const salt = new Uint8Array(hexToBuffer(parsed.salt));
          const key = await deriveKey(pass, salt);
          const updatedPayload = await encryptData(cache, key);
          newEncryptedVault = {
            salt: parsed.salt,
            verifier: parsed.verifier,
            payload: updatedPayload,
            updatedAt: Date.now()
          };

          let email = 'fabianombraga@gmail.com';
          if (res['safepass_cloud_user']) {
            try {
              const u = JSON.parse(res['safepass_cloud_user']);
              if (u && u.email) email = u.email;
            } catch(e){}
          }

          const token = res['safepass_cloud_token'];
          const pushUrl = `https://4u.ia.br/app/safepass/index.php?action=push&email=${encodeURIComponent(email)}` + (token ? `&token=${encodeURIComponent(token)}` : '');
          fetch(pushUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vault_data: newEncryptedVault, email })
          }).catch(()=>{});

          // Notifica abas do SafePass Web abertas para atualizar em tempo real
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              if (tab.url && (tab.url.includes('4u.ia.br/app/safepass') || tab.url.includes('localhost:8080/app/safepass'))) {
                chrome.tabs.sendMessage(tab.id, { action: 'direct_inject_full_vault', vault_data: newEncryptedVault }, () => {
                  if (chrome.runtime.lastError) {}
                });
              }
            });
          });
        } catch(e) {}
      }

      const toSave = {
        'safepass_pending_vault_items': pending,
        'safepass_unlocked_vault_cache': cache
      };
      if (newEncryptedVault) {
        toSave[STORAGE_KEY] = JSON.stringify(newEncryptedVault);
      }

      chrome.storage.local.set(toSave, () => {
        try {
          if (pending.length > 0) {
            chrome.action.setBadgeText({ text: String(pending.length) });
            chrome.action.setBadgeBackgroundColor({ color: '#6d4aff' });
          } else {
            chrome.action.setBadgeText({ text: '' });
          }
        } catch(e){}

        sendResponse({ success: true, count: pending.length });
      });
    });
    return true;
  } else if (request.action === 'sync_vault_from_web') {
    if (request.vault_data) {
      chrome.storage.local.set({
        [STORAGE_KEY]: JSON.stringify(request.vault_data)
      }, () => {
        autoDecryptPersistentCache();
        sendResponse({ success: true });
      });
    }
    return true;
  } else if (request.action === 'get_matched_logins') {
    const domain = (request.domain || '').replace(/^www\./i, '').toLowerCase();

    chrome.storage.local.get(['safepass_pending_vault_items', 'safepass_unlocked_vault_cache'], async (res) => {
      let pending = res['safepass_pending_vault_items'] || [];
      let cache = res['safepass_unlocked_vault_cache'] || [];

      // Se o cache local estiver vazio, tenta auto-descriptografar se a sessão for persistente
      if (cache.length === 0) {
        const decrypted = await autoDecryptPersistentCache();
        if (decrypted && Array.isArray(decrypted)) {
          cache = decrypted;
        }
      }

      const matches = [];
      const addedKeys = new Set();

      // 1. Busca no cache de senhas desbloqueadas
      cache.forEach(item => {
        if ((!item.type || item.type === 'login' || item.password) && isDomainMatch(item, domain)) {
          const key = (item.username || '') + '|' + (item.password || '');
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            matches.push(item);
          }
        }
      });

      // 2. Busca também nas pendentes recém-salvas
      pending.forEach(item => {
        if ((!item.type || item.type === 'login' || item.password) && isDomainMatch(item, domain)) {
          const key = (item.username || '') + '|' + (item.password || '');
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            matches.push(item);
          }
        }
      });

      // 3. Fallback: se ainda não achou e houver aba web aberta, consulta a aba
      if (matches.length === 0) {
        chrome.tabs.query({}, (tabs) => {
          const webTab = tabs.find(tab => tab.url && (tab.url.includes('4u.ia.br/app/safepass') || tab.url.includes('localhost:8080/app/safepass')));
          if (webTab) {
            chrome.tabs.sendMessage(webTab.id, { action: 'query_matches', domain }, (webRes) => {
              if (chrome.runtime.lastError) {
                sendResponse({ logins: [] });
                return;
              }
              if (webRes && webRes.logins && webRes.logins.length > 0) {
                chrome.storage.local.set({ 'safepass_unlocked_vault_cache': webRes.logins });
                sendResponse({ logins: webRes.logins });
              } else {
                sendResponse({ logins: [] });
              }
            });
          } else {
            sendResponse({ logins: [] });
          }
        });
      } else {
        sendResponse({ logins: matches });
      }
    });
    return true;
  } else if (request.action === 'set_pending_prompt') {
    const p = request.data ? { ...request.data, timestamp: Date.now() } : null;
    chrome.storage.local.set({ 'safepass_pending_prompt': p }, () => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'get_pending_prompt') {
    chrome.storage.local.get(['safepass_pending_prompt'], (res) => {
      sendResponse({ prompt: res['safepass_pending_prompt'] || null });
    });
    return true;
  } else if (request.action === 'clear_pending_prompt') {
    chrome.storage.local.remove('safepass_pending_prompt', () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

