let overviewInitialized = false;

function applyScenarioV2(root = document) {
  const overview = root.querySelector('.scenario-overview');
  if (overview && !overviewInitialized) {
    overview.removeAttribute('open');
    overviewInitialized = true;
  }

  root.querySelectorAll('.speaker-avatar.assistant').forEach(avatar => {
    if (avatar.textContent.trim() === '🤖') avatar.textContent = 'AI';
  });

  root.querySelectorAll('.flow-actor.assistant i').forEach(icon => {
    if (icon.textContent.trim() === '🤖') icon.textContent = 'AI';
  });

  root.querySelectorAll('.tour-interaction span').forEach(item => {
    item.textContent = item.textContent.replace('👤 ', '').replace('🤖 ', '');
  });
}

const observer = new MutationObserver(() => applyScenarioV2());
observer.observe(document.documentElement, { childList: true, subtree: true });
applyScenarioV2();
