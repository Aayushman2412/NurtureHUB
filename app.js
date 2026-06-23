/* ═══════════════════════════════════════════════════════════════
   NurtureHUB — Interactive Prototype Logic
   Complete navigation, form interactions, test engine, and UI state
   ═══════════════════════════════════════════════════════════════ */

// ── State Management ────────────────────────────────────────────
const state = {
  currentScreen: 'screen-landing',
  currentRegStep: 1,
  totalRegSteps: 3,
  currentQuestion: 8,
  totalQuestions: 25,
  testTimerInterval: null,
  testTimeRemaining: 1662, // 27:42 in seconds
  sidebarOpen: false,
  notifPanelOpen: false,
  answers: { 1: 'B', 2: 'A', 3: 'C', 4: 'D', 5: 'B', 6: 'A', 8: 'B' },
  reviewedQuestions: new Set([4, 7]),
  screenHistory: [],
};

// ── Screen Navigation ───────────────────────────────────────────
function navigateTo(screenId) {
  // Push current screen to history
  if (state.currentScreen && state.currentScreen !== screenId) {
    state.screenHistory.push(state.currentScreen);
  }

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Show target screen
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    state.currentScreen = screenId;
  }

  // Update sidebar active state
  updateSidebarActive(screenId);

  // Close mobile sidebar if open
  closeSidebar();

  // Scroll to top
  window.scrollTo(0, 0);

  // Screen-specific initialization
  if (screenId === 'screen-test-active') {
    startTestTimer();
  } else {
    stopTestTimer();
  }

  if (screenId === 'screen-test-submitted') {
    triggerConfetti();
  }
}

function goBack() {
  if (state.screenHistory.length > 0) {
    const prev = state.screenHistory.pop();
    navigateTo(prev);
  }
}

function updateSidebarActive(screenId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.screen === screenId) {
      item.classList.add('active');
    }
  });
}

// ── Login Handler ───────────────────────────────────────────────
function handleLogin() {
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');

  // Simple validation visual
  if (email && password) {
    showToast('Signing in...', 'info');
    setTimeout(() => {
      showToast('Welcome back, Priya!', 'success');
      navigateTo('screen-dashboard');
    }, 1200);
  }
}

// ── Password Toggle ─────────────────────────────────────────────
function togglePassword(el) {
  const input = el.parentElement.querySelector('input');
  if (input.type === 'password') {
    input.type = 'text';
    el.textContent = '🙈';
  } else {
    input.type = 'password';
    el.textContent = '👁';
  }
}

// ── Registration Form Steps ─────────────────────────────────────
function regNextStep() {
  if (state.currentRegStep < state.totalRegSteps) {
    state.currentRegStep++;
    updateRegStep();
  } else {
    // Submit registration
    showToast('Registration completed successfully!', 'success');
    setTimeout(() => navigateTo('screen-dashboard'), 1200);
  }
}

function regPrevStep() {
  if (state.currentRegStep > 1) {
    state.currentRegStep--;
    updateRegStep();
  }
}

function updateRegStep() {
  // Update step content
  document.querySelectorAll('.reg-step').forEach(s => s.classList.remove('active'));
  const activeStep = document.getElementById(`reg-step-${state.currentRegStep}`);
  if (activeStep) activeStep.classList.add('active');

  // Update stepper indicators
  const stepper = document.getElementById('reg-stepper');
  stepper.querySelectorAll('.stepper-step').forEach((step, i) => {
    step.classList.remove('active', 'completed');
    const stepNum = i + 1;
    if (stepNum < state.currentRegStep) step.classList.add('completed');
    if (stepNum === state.currentRegStep) step.classList.add('active');
  });

  // Update buttons
  const backBtn = document.getElementById('reg-back-btn');
  const nextBtn = document.getElementById('reg-next-btn');

  backBtn.style.visibility = state.currentRegStep === 1 ? 'hidden' : 'visible';
  nextBtn.textContent = state.currentRegStep === state.totalRegSteps ? 'Complete Registration ✓' : 'Continue →';
}

// ── Sidebar Toggle ──────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  state.sidebarOpen = !state.sidebarOpen;
  sidebar.classList.toggle('open', state.sidebarOpen);
  overlay.classList.toggle('active', state.sidebarOpen);
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  state.sidebarOpen = false;
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

// ── Notification Panel ──────────────────────────────────────────
function toggleNotifPanel() {
  state.notifPanelOpen = !state.notifPanelOpen;
  document.getElementById('notifPanel').classList.toggle('open', state.notifPanelOpen);
}

// ── Test Timer ──────────────────────────────────────────────────
function startTestTimer() {
  stopTestTimer();
  state.testTimeRemaining = 1662; // Reset
  updateTimerDisplay();
  state.testTimerInterval = setInterval(() => {
    state.testTimeRemaining--;
    updateTimerDisplay();

    const timer = document.getElementById('testTimer');
    if (state.testTimeRemaining <= 300) {
      timer.classList.add('warning');
      timer.classList.remove('danger');
    }
    if (state.testTimeRemaining <= 60) {
      timer.classList.remove('warning');
      timer.classList.add('danger');
    }
    if (state.testTimeRemaining <= 0) {
      stopTestTimer();
      showToast('Time\'s up! Test auto-submitted.', 'warning');
      setTimeout(() => navigateTo('screen-test-submitted'), 1500);
    }
  }, 1000);
}

function stopTestTimer() {
  if (state.testTimerInterval) {
    clearInterval(state.testTimerInterval);
    state.testTimerInterval = null;
  }
}

function updateTimerDisplay() {
  const display = document.getElementById('timerDisplay');
  if (display) {
    const min = Math.floor(state.testTimeRemaining / 60);
    const sec = state.testTimeRemaining % 60;
    display.textContent = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
}

// ── Question Navigation ─────────────────────────────────────────
function goToQuestion(num) {
  if (num < 1 || num > state.totalQuestions) return;
  state.currentQuestion = num;
  
  // Update question nav
  document.querySelectorAll('.q-num').forEach(el => {
    el.classList.remove('current');
    if (parseInt(el.dataset.q) === num) {
      el.classList.add('current');
    }
  });

  // Update progress bar
  const progressText = document.querySelectorAll('.test-progress-bar span');
  if (progressText.length >= 2) {
    progressText[0].textContent = `Question ${num} of ${state.totalQuestions}`;
    const pct = Math.round((num / state.totalQuestions) * 100);
    progressText[1].textContent = `${pct}%`;
  }
  const progressFill = document.querySelector('.test-progress-bar .fill');
  if (progressFill) {
    progressFill.style.width = `${(num / state.totalQuestions) * 100}%`;
  }

  // Update question number display
  const qNum = document.querySelector('.question-number');
  if (qNum) qNum.textContent = `Question ${num}`;

  // Clear current selection visual for demo
  document.querySelectorAll('.option-item').forEach(opt => opt.classList.remove('selected'));
  
  // Show selected answer if one exists
  if (state.answers[num]) {
    const options = document.querySelectorAll('.option-item');
    const answerIndex = 'ABCD'.indexOf(state.answers[num]);
    if (options[answerIndex]) {
      options[answerIndex].classList.add('selected');
    }
  }
}

// ── Select Option ───────────────────────────────────────────────
function selectOption(el) {
  if (el === null) {
    // Clear answer
    document.querySelectorAll('.option-item').forEach(opt => opt.classList.remove('selected'));
    delete state.answers[state.currentQuestion];
    updateQuestionNavState();
    return;
  }
  // Deselect all
  document.querySelectorAll('.option-item').forEach(opt => opt.classList.remove('selected'));
  // Select clicked
  el.classList.add('selected');
  
  // Record answer
  const options = document.querySelectorAll('.option-item');
  const index = Array.from(options).indexOf(el);
  state.answers[state.currentQuestion] = 'ABCD'[index];
  
  // Update nav state
  updateQuestionNavState();
}

function updateQuestionNavState() {
  document.querySelectorAll('.q-num').forEach(el => {
    const q = parseInt(el.dataset.q);
    el.classList.remove('answered');
    if (state.answers[q]) {
      el.classList.add('answered');
    }
  });
}

// ── Submit Modal ────────────────────────────────────────────────
function showSubmitModal() {
  document.getElementById('submitModal').classList.add('active');
}

function hideSubmitModal() {
  document.getElementById('submitModal').classList.remove('active');
}

// ── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <span style="font-size: 1.25rem;">${icons[type] || icons.info}</span>
    <span style="flex: 1; font-size: 0.9375rem;">${message}</span>
    <button onclick="this.parentElement.remove()" style="font-size: 1.1rem; color: var(--gray-400); cursor: pointer; background: none; border: none;">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Confetti Effect ─────────────────────────────────────────────
function triggerConfetti() {
  const colors = ['#0FADA0', '#F59E0B', '#3182CE', '#38A169', '#E53E3E', '#764ba2', '#f5576c'];
  for (let i = 0; i < 60; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti-piece';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
    confetti.style.animationDelay = Math.random() * 1.5 + 's';
    confetti.style.width = (Math.random() * 8 + 6) + 'px';
    confetti.style.height = (Math.random() * 8 + 6) + 'px';
    confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 5000);
  }
}

// ── Filter Chips ────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('filter-chip')) {
    // If it's the "All" chip, deselect others
    if (e.target.textContent.includes('All')) {
      e.target.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
    } else {
      // Deselect "All" chip
      const allChip = e.target.parentElement.querySelector('.filter-chip:first-child');
      if (allChip && allChip.textContent.includes('All')) {
        allChip.classList.remove('active');
      }
    }
  }
});

// ── Settings Nav ────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('settings-nav-item')) {
    e.target.parentElement.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
    e.target.classList.add('active');
    showToast('Settings section switched (demo)', 'info');
  }
});

// ── Tab Items ───────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('tab-item')) {
    e.target.parentElement.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
  }
});

// ── Responsive: Auto-close sidebar on resize ────────────────────
window.addEventListener('resize', () => {
  if (window.innerWidth > 1024 && state.sidebarOpen) {
    closeSidebar();
  }
});

// ── Keyboard Shortcuts ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Escape to close modals/panels
  if (e.key === 'Escape') {
    hideSubmitModal();
    if (state.notifPanelOpen) toggleNotifPanel();
    if (state.sidebarOpen) closeSidebar();
  }

  // In test mode: arrow keys for navigation
  if (state.currentScreen === 'screen-test-active') {
    if (e.key === 'ArrowLeft' && state.currentQuestion > 1) {
      goToQuestion(state.currentQuestion - 1);
    }
    if (e.key === 'ArrowRight' && state.currentQuestion < state.totalQuestions) {
      goToQuestion(state.currentQuestion + 1);
    }
  }
});

// ── OTP Input Auto-focus ────────────────────────────────────────
document.querySelectorAll('#screen-otp input[maxlength="1"]').forEach((input, index, inputs) => {
  input.addEventListener('input', (e) => {
    if (e.target.value && index < inputs.length - 1) {
      inputs[index + 1].focus();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && index > 0) {
      inputs[index - 1].focus();
    }
  });
});

// ── Mobile Test Sidebar Toggle ──────────────────────────────────
const testSidebarToggle = document.getElementById('toggleTestSidebar');
if (testSidebarToggle) {
  testSidebarToggle.addEventListener('click', () => {
    document.getElementById('testSidebar').classList.toggle('open');
  });
}

// ── Initialize ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Show landing page by default
  navigateTo('screen-landing');
  
  // Add smooth class transitions
  document.body.style.opacity = '1';
  
  console.log('🌱 NurtureHUB Interactive Prototype Loaded');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Screens: Landing, Login, Signup, Forgot Password, OTP, Registration, Dashboard, Tutorials, Tutorial Player, Tests, Test Instructions, Active Test, Submit, Results, Profile');
  console.log('Navigation: Click any button/link to navigate between screens');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
