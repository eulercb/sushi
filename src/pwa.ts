/// <reference types="vite/client" />

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function initPwa(): void {
  const install = document.querySelector<HTMLButtonElement>('#install');
  let pending: InstallPrompt | undefined;
  if (install) install.hidden = true;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pending = event as InstallPrompt;
    if (install) install.hidden = false;
  });
  install?.addEventListener('click', async () => {
    if (!pending) return;
    const prompt = pending;
    pending = undefined;
    install.hidden = true;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { /* Installation remains optional if the browser declines. */ }
  });
  window.addEventListener('appinstalled', () => {
    pending = undefined;
    if (install) install.hidden = true;
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () => {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      }).catch(() => { /* Online play still works if offline setup is unavailable. */ });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}
