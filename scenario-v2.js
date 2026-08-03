let overviewInitialized = false;

function enforceMonochromeNavigation(root = document) {
  root.querySelectorAll('.nav-item').forEach(button => {
    const isActive = button.classList.contains('active');
    const isDisabled = button.getAttribute('aria-disabled') === 'true';

    button.style.setProperty('background', isActive ? '#252525' : 'transparent', 'important');
    button.style.setProperty('box-shadow', isActive ? 'inset 0 -2px #ffffff' : 'none', 'important');
    button.style.setProperty('color', isActive ? '#ffffff' : (isDisabled ? '#666666' : '#a8a8a8'), 'important');
    button.style.setProperty('border-color', 'transparent', 'important');
  });
}

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

  enforceMonochromeNavigation(root);
}

const observer = new MutationObserver(() => applyScenarioV2());
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'aria-disabled']
});

applyScenarioV2();
