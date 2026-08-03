let overviewInitialized = false;
let scheduled = false;

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
}

function scheduleApply(root) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyScenarioV2(root);
  });
}

const viewRoot = document.querySelector('#viewRoot');
if (viewRoot) {
  const observer = new MutationObserver(() => scheduleApply(viewRoot));
  observer.observe(viewRoot, { childList: true });
  applyScenarioV2(viewRoot);
}
