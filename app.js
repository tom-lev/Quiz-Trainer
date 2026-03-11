// ── Exam source links (Hebrew) ──
const EXAM_LINKS = {
  "בחינה לדוגמא גרסה א'": {
    questions: "https://drive.google.com/file/d/1ITyEyYBcyt83lotyH11FmKZxeGcZSdSG/view?usp=sharing",
    answers:   "https://drive.google.com/file/d/1Ggu4pRLSpIKk1KUdZMkjlc5ZHbmjhe3F/view?usp=sharing"
  },
  "בחינה לדוגמא גרסה ב'": {
    questions: "https://drive.google.com/file/d/1hF8k8w0KjT3Mt4y9fUalC2bmN8OV56jc/view?usp=sharing",
    answers:   "https://drive.google.com/file/d/1HSSRsHzaL5IaeS080pNZndKJqgz-08HJ/view?usp=sharing"
  },
  "בחינה לדוגמא גרסה ג'": {
    questions: "https://drive.google.com/file/d/1n-L4LTkRl7ddR6KSU11MjH5S_nTuZLH9/view?usp=sharing",
    answers:   "https://drive.google.com/file/d/1xfUXdXLNc6kXsyBTrBuhvfMFxVGELtZK/view?usp=sharing"
  },
  "בחינה לדוגמא גרסה ד'": {
    questions: "https://drive.google.com/file/d/1y_b24Eh06dfC9Vwg3MnSC0n1x6f5Rnef/view?usp=sharing",
    answers:   "https://drive.google.com/file/d/1EFur0G3QJM1kc0AXh6sOcWA3PrcAtwNN/view?usp=sharing"
  }
};

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  const sw = document.getElementById('theme-switch-btn');
  if (sw) sw.classList.toggle('on', isLight);
  localStorage.setItem('istqb_theme', isLight ? 'light' : 'dark');
}

// Load saved theme — default is light mode
(function() {
  const saved = localStorage.getItem('istqb_theme');
  const isDark = saved === 'dark';
  if (!isDark) {
    document.body.classList.add('light-mode');
  }
  document.addEventListener('DOMContentLoaded', () => {
    const sw = document.getElementById('theme-switch-btn');
    if (sw) sw.classList.toggle('on', !isDark);
  });
})();

// Navigate from sidebar: go home first then start mode
function navStartMode(mode) {
  SESSION.mode = mode;
  // Close sidebar on mobile
  const nav = document.getElementById('global-nav');
  if (nav && window.innerWidth < 700) {
    nav.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (btn) { btn.textContent = '☰'; btn.style.right = '1rem'; }
  }
  startMode(mode);
}
let ALL_Q_HE = [];
let ACTIVE_Q = [];  // the pool currently in use (en or he)
let ALL_GLOSSARY = [];  // 324 glossary terms
let FC_POOL = [];        // current flashcard pool (filtered/shuffled — set in FLASHCARDS section)
let FC_KNOWN = new Set();
let FC_DIRECTION = 'def';
let FC_VIEW = 'one';
let FCO_IDX = 0;
let CURRENT_LANG = 'he';
let SESSION = { questions: [], idx: 0, correct: 0, wrong: 0, skipped: 0, answers: [], mode: '' };

// One-time cleanup: remove any leftover localStorage from old version
(function() {
  const keys = ['istqb_wrong','istqb_best','istqb_answered','istqb_unique','istqb_history'];
  keys.forEach(k => localStorage.removeItem(k));
})();

// All data lives in Firestore only — no localStorage
let WRONG_IDS    = [];
let BEST         = null;
let ANSWERED_IDS = [];
let UNIQUE_IDS   = [];
let QUIZ_HISTORY = [];
let STARRED_IDS  = [];   // ⭐ starred question indices
let NOTES        = {};   // { questionIndex: "note text" }
let SPEED_MODE    = false;
let SPEED_SECONDS = 30; // default 30s, configurable 10–90
let SPEED_TIMER  = null;

// ── Firestore bridge (set by Firebase module once ready) ──
window._fbSaveUserData  = null;
window._fbClearUserData = null;
window._currentUser     = null;

// Called whenever data changes
let _pendingPersist = false;
let _lastSaveTime = 0;
window._cloudDataReady = false; // set to true once Firestore user data is loaded

async function persistData() {
  if (!window._fbSaveUserData || !window._currentUser) {
    _pendingPersist = true;
    return;
  }
  // Don't overwrite Firestore with empty data before cloud data has loaded
  if (!window._cloudDataReady) {
    _pendingPersist = true;
    return;
  }
  _pendingPersist = false;
  _lastSaveTime = Date.now();
  const payload = { wrongIds: WRONG_IDS, best: BEST, answeredIds: ANSWERED_IDS,
                    uniqueIds: UNIQUE_IDS, starredIds: STARRED_IDS, notes: NOTES };
  try { sessionStorage.setItem('istqb_session_data', JSON.stringify(payload)); } catch(e) {}
  console.log('[PERSIST] Saving starredIds:', JSON.stringify(STARRED_IDS));
  if (!window._fbSaveUserData || !window._currentUser) { _pendingPersist = true; return; }
  try {
    await window._fbSaveUserData({
      wrongIds:    WRONG_IDS,
      best:        BEST,
      answeredIds: ANSWERED_IDS,
      uniqueIds:   UNIQUE_IDS,
      starredIds:  STARRED_IDS,
      notes:       NOTES
    });
  } catch(e) { console.error('persistData failed:', e); }
  console.log('[PERSIST] Save complete');
}

// Called after login — load cloud data directly into memory
window.loadCloudData = async function(data) {
  if (!data) return;
  // sessionStorage = same browser/device this session → always preferred (it's the freshest local state)
  // No sessionStorage = new device/browser → load from Firestore
  // We do NOT write back to Firestore when restoring from sessionStorage (it's just a refresh)
  const sessionKey = 'istqb_session_data';
  const sessionRaw = sessionStorage.getItem(sessionKey);
  if (sessionRaw) {
    try {
      const local = JSON.parse(sessionRaw);
      WRONG_IDS    = local.wrongIds    ?? [];
      BEST         = local.best        ?? null;
      ANSWERED_IDS = local.answeredIds ?? [];
      UNIQUE_IDS   = local.uniqueIds   ?? [];
      STARRED_IDS  = local.starredIds  ?? [];
      NOTES        = local.notes       ?? {};
      console.log('[LOAD] Restored from sessionStorage, starredIds count:', STARRED_IDS.length);
      window._cloudDataReady = true;
      const bestElS = document.getElementById('stat-best');
      if (bestElS) bestElS.textContent = BEST ? BEST + '%' : '—';
      updateWrongCount(); updateAnsweredStats(); updateStarredCount();
      if (_pendingPersist) await persistData();
      return;
    } catch(e) { sessionStorage.removeItem(sessionKey); }
  }
  // First load this session — use Firestore data
  WRONG_IDS    = Array.isArray(data.wrongIds)    ? data.wrongIds    : [];
  BEST         = data.best                        ? data.best        : null;
  ANSWERED_IDS = Array.isArray(data.answeredIds) ? data.answeredIds : [];
  UNIQUE_IDS   = Array.isArray(data.uniqueIds)   ? data.uniqueIds   : [];
  STARRED_IDS  = Array.isArray(data.starredIds)  ? data.starredIds  : [];
  NOTES        = (data.notes && typeof data.notes === 'object') ? data.notes : {};
  console.log('[LOAD] Loaded from Firestore, starredIds count:', STARRED_IDS.length);

  window._cloudDataReady = true;

  const bestEl = document.getElementById('stat-best');
  if (bestEl) bestEl.textContent = BEST ? BEST + '%' : '—';
  updateWrongCount();
  updateAnsweredStats();
  updateStarredCount();

  // Flush any saves that were blocked while waiting for cloud data
  if (_pendingPersist) persistData();
}

async function loadQuestions() {
  try {
    const [respEn, respHe, respGlossary] = await Promise.all([
      fetch('questions.json'),
      fetch('questions_he.json'),
      fetch('glossary_he.json').catch(() => null)
    ]);
    ALL_Q    = await respEn.json();
    ALL_Q_HE = await respHe.json();
    ACTIVE_Q = ALL_Q;
    if (respGlossary) {
      try { ALL_GLOSSARY = await respGlossary.json(); } catch(e) {}
    }

    // ── Merge admin edits from Firestore (non-blocking) ──
    // Don't await — let the app init immediately from JSON,
    // then apply Firestore edits in the background
    applyAdminEdits();

    window._questionsReady = true;
    if (window._authReady) init();
  } catch(e) {
    // Try loading English only if Hebrew fails
    try {
      const resp = await fetch('questions.json');
      ALL_Q    = await resp.json();
      ALL_Q_HE = [];
      ACTIVE_Q = ALL_Q;
      window._questionsReady = true;
      if (window._authReady) init();
    } catch(e2) {
      document.getElementById('loading').innerHTML = '<span style="color:#ff6584">⚠ Could not load questions.json</span>';
    }
  }
}

// ── Load admin edits from Firestore and apply over the base JSON ──
async function applyAdminEdits(retryCount = 0) {
  try {
    const projectId = 'istqb-practice-app';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/editedQuestions?pageSize=300`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.documents) return;

    let count = 0;
    for (const docSnap of json.documents) {
      // Extract index from document name e.g. ".../editedQuestions/42" → 42
      const idx  = parseInt(docSnap.name.split('/').pop(), 10);
      const data = firestoreDocToObj(docSnap.fields);
      if (isNaN(idx)) continue;
      if (data.lang === 'he' && ALL_Q_HE[idx]) {
        ALL_Q_HE[idx] = { ...ALL_Q_HE[idx], ...data };
        count++;
      } else if (data.lang !== 'he' && ALL_Q[idx]) {
        ALL_Q[idx] = { ...ALL_Q[idx], ...data };
        count++;
      }
    }
    console.log(`[ADMIN] Applied ${count} edited question(s) from Firestore REST`);
  } catch(e) {
    if (retryCount < 3) {
      const delay = (retryCount + 1) * 2000;
      console.warn(`[ADMIN] Firestore REST unavailable, retrying in ${delay/1000}s...`);
      setTimeout(() => applyAdminEdits(retryCount + 1), delay);
    } else {
      console.warn('[ADMIN] Could not load edits after retries:', e);
    }
  }
}

// Convert Firestore REST field format to plain JS object
function firestoreDocToObj(fields) {
  if (!fields) return {};
  const obj = {};
  for (const [key, val] of Object.entries(fields)) {
    obj[key] = firestoreValueToJs(val);
  }
  return obj;
}
function firestoreValueToJs(val) {
  if (val.stringValue  !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue  !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue    !== undefined) return null;
  if (val.arrayValue   !== undefined) return (val.arrayValue.values || []).map(firestoreValueToJs);
  if (val.mapValue     !== undefined) return firestoreDocToObj(val.mapValue.fields);
  return null;
}

function setLang(lang) {
  CURRENT_LANG = lang;
  ACTIVE_Q = lang === 'he' ? ALL_Q_HE : ALL_Q;
  const he = lang === 'he';

  // Toggle body class for RTL styling
  document.body.classList.toggle('lang-he', he);

  // Update lang buttons
  document.getElementById('lang-en-btn').classList.toggle('active', !he);
  document.getElementById('lang-he-btn').classList.toggle('active', he);

  // ── Hero area ──
  const heroBadge = document.querySelector('#home .badge');
  if (heroBadge) heroBadge.textContent = he ? '✦ הכנה ל-ISTQB CTFL' : '✦ ISTQB CTFL Prep';

  const heroSub = document.querySelector('#home .hero-sub');
  if (heroSub) heroSub.textContent = he ? 'הסמכת בדיקות רמה בסיסית' : 'Foundation Level Certification Practice';

  // ── Stats strip labels ──
  const statBestLbl = document.querySelector('#home .stats-strip .stat-item:nth-child(1) .stat-label');
  const statUniqLbl = document.querySelector('#home .stats-strip .stat-item:nth-child(2) .stat-label');
  const statAnsLbl  = document.querySelector('#home .stats-strip .stat-item:nth-child(3) .stat-label');
  if (statBestLbl) statBestLbl.textContent = he ? 'שיא' : 'Best Score';
  if (statUniqLbl) statUniqLbl.textContent = he ? 'שאלות ייחודיות' : 'Unique Qs';
  if (statAnsLbl)  statAnsLbl.textContent  = he ? 'תשובות' : 'Answered';

  // ── Mode cards ──
  const mc = (id) => document.getElementById(id);
  if (mc('mc-title-random')) {
    mc('mc-title-random').textContent = he ? 'חידון אקראי' : 'Random Quiz';
    mc('mc-desc-random').textContent  = he ? 'שאלות אקראיות מכל המאגרים. הגדר כמות, מקור ורמת קושי.' : 'Random questions from all sets. Configure count, source & difficulty.';
    mc('mc-title-exam').textContent   = he ? 'סימולציית בחינה' : 'Full Exam Simulation';
    mc('mc-desc-exam').textContent    = he ? '40 שאלות המדמות תנאי ISTQB אמיתיים.' : '40-question exam simulating real ISTQB conditions.';
    mc('mc-count-exam').textContent   = he ? '40 שאלות' : '40 Questions';
    mc('mc-title-speed').textContent  = he ? 'שאלות על זמן' : 'Speed Mode';
    mc('mc-desc-speed').textContent   = he ? `קבעו זמן לשאלה: 10–90 שניות — טעות אוטומטית אם לא עונים בזמן.` : `Set time per question: 10–90 seconds — auto-wrong if time runs out.`;
    mc('mc-count-speed').textContent  = he ? `10–90 שנ׳ לשאלה` : `10–90s / question`;
  }

  // ── Sidebar labels ──
  const navLabelModes  = document.getElementById('nav-label-modes');
  const navLabelSaved  = document.getElementById('nav-label-saved');
  const navLblRandom   = document.getElementById('nav-lbl-random');
  const navLblExam     = document.getElementById('nav-lbl-exam');
  const navLblSpeed    = document.getElementById('nav-lbl-speed');
  if (navLabelModes) navLabelModes.textContent = he ? 'חידונים' : 'Modes';
  if (navLabelSaved) navLabelSaved.textContent = he ? 'שמור' : 'Saved';
  if (navLblRandom) navLblRandom.childNodes[0].textContent = he ? 'חידון אקראי' : 'Random Quiz';
  if (navLblExam)   navLblExam.childNodes[0].textContent   = he ? 'סימולציית בחינה' : 'Exam Sim';
  if (navLblSpeed)  navLblSpeed.childNodes[0].textContent  = he ? 'שאלות על זמן' : 'Speed Mode';

  const navThemeLabel = document.getElementById('nav-theme-label');
  if (navThemeLabel) navThemeLabel.textContent = he ? 'מצב לילה' : 'Dark mode';

  // ── Auth buttons ──
  const btnLogin  = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogin) {
    const svgEl = btnLogin.querySelector('svg');
    btnLogin.innerHTML = '';
    if (svgEl) btnLogin.appendChild(svgEl);
    btnLogin.appendChild(document.createTextNode(he ? ' התחבר עם Google' : ' Sign in with Google'));
  }
  if (btnLogout) btnLogout.textContent = he ? 'התנתק' : 'Sign Out';

  // ── Swap source checkboxes ──
  const srcEn = document.getElementById('src-checks-en');
  const srcHe = document.getElementById('src-checks-he');
  if (srcEn && srcHe) {
    srcEn.classList.toggle('hidden', he);
    srcHe.classList.toggle('hidden', !he);
  }

  // ── Config labels ──
  const lbl = document.getElementById('lbl-source-field');
  const lblCount = document.getElementById('lbl-count-label');
  const lblOrder = document.getElementById('lbl-order-field');
  if (lbl)      lbl.textContent      = he ? 'מקור' : 'Source';
  if (lblCount) lblCount.textContent = he ? 'מספר שאלות' : 'Number of Questions';
  if (lblOrder) lblOrder.textContent = he ? 'סדר' : 'Order';

  // ── sel-order options ──
  const selOrder = document.getElementById('sel-order');
  if (selOrder) {
    selOrder.options[0].text = he ? 'אקראי' : 'Shuffled';
    selOrder.options[1].text = he ? 'רציף' : 'Sequential';
  }

  // ── Config buttons ──
  const btnStart = document.getElementById('btn-start-quiz');
  const btnBack  = document.getElementById('btn-config-back');
  if (btnStart) btnStart.textContent = he ? '← התחל חידון' : 'Start Quiz →';
  if (btnBack)  btnBack.textContent  = he ? '→ חזרה' : '← Back';

  // ── Quiz buttons ──
  const btnSkip = document.getElementById('btn-skip');
  const btnNext = document.getElementById('btn-next');
  if (btnSkip) btnSkip.textContent = he ? 'דלג ←' : 'Skip →';
  if (btnNext) btnNext.textContent = he ? 'הבא ←' : 'Next →';

  // ── Results page ──
  const scoreLabel = document.querySelector('#results .score-label');
  if (scoreLabel) scoreLabel.textContent = he ? 'ציון' : 'Score';

  const rsCorrectLbl = document.querySelector('#rs-correct + .rstat-label') ||
    document.querySelector('#results .rstat:nth-child(1) .rstat-label');
  const rsWrongLbl   = document.querySelector('#results .rstat:nth-child(2) .rstat-label');
  const rsSkippedLbl = document.querySelector('#results .rstat:nth-child(3) .rstat-label');
  if (rsCorrectLbl) rsCorrectLbl.textContent = he ? 'נכון' : 'Correct';
  if (rsWrongLbl)   rsWrongLbl.textContent   = he ? 'שגוי' : 'Wrong';
  if (rsSkippedLbl) rsSkippedLbl.textContent = he ? 'דולג' : 'Skipped';

  const btnHome        = document.querySelector('#results .btn-row .btn-primary');
  const btnReview      = document.querySelector('#results .btn-row .btn-ghost:nth-child(2)');
  const btnRetryWrong  = document.getElementById('btn-retry-wrong');
  if (btnHome)       btnHome.textContent       = he ? '→ בית' : '← Home';
  if (btnReview)     btnReview.textContent     = he ? 'סקירת תשובות' : 'Review Answers';
  if (btnRetryWrong) btnRetryWrong.textContent = he ? 'תרגל שגיאות' : 'Retry Wrong';

  const reviewHeading = document.querySelector('.review-heading');
  if (reviewHeading) reviewHeading.textContent = he ? '📝 סקירת תשובות' : '📝 Answer Review';

  // ── Guest banner ──
  const loginBannerTitle = document.querySelector('#login-wall .login-sub strong');
  const loginBannerSub   = document.querySelector('#login-wall .login-sub');
  if (loginBannerTitle) loginBannerTitle.textContent = he ? '⚠️ מצב אורח' : '⚠️ Guest Mode';
  if (loginBannerSub) {
    // keep the strong tag, replace text node
    const strong = loginBannerSub.querySelector('strong');
    loginBannerSub.innerHTML = '';
    if (strong) loginBannerSub.appendChild(strong);
    loginBannerSub.appendChild(document.createTextNode(
      he ? ' ההתקדמות לא נשמרת — התחבר כדי לשמור בין מכשירים'
         : ' Progress is not saved — sign in to sync across devices'
    ));
  }

  // ── Top logo bar ──
  const logoBtn = document.querySelector('.logo-home-btn');
  if (logoBtn) {
    logoBtn.innerHTML = `<span class="logo-mark">✦</span> ${he ? 'תרגול ISTQB' : 'ISTQB Practice'}`;
  }

  // Update hero title
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle) heroTitle.innerHTML = he ? 'תרגול<br>ISTQB' : 'ISTQB<br>Practice';

  // ── Update question count display ──
  document.getElementById('count-random').textContent = ACTIVE_Q.length + (he ? ' שאלות' : ' Questions');
  updateWrongCount();
  updateAnsweredStats();
  updateStarredCount();

  // ── K-level selector labels ──
  const selKlevel = document.getElementById('sel-klevel');
  if (selKlevel) {
    selKlevel.options[0].text = he ? 'כל הרמות' : 'All Levels';
    selKlevel.options[1].text = he ? 'K1 — זכירה' : 'K1 — Knowledge';
    selKlevel.options[2].text = he ? 'K2 — הבנה' : 'K2 — Comprehension';
    selKlevel.options[3].text = he ? 'K3 — יישום' : 'K3 — Application';
  }
  const lblKlevel = document.getElementById('lbl-klevel-field');
  if (lblKlevel) lblKlevel.textContent = he ? 'רמת קושי' : 'Difficulty';
}

window.init = function() {
  document.getElementById('stat-total').textContent = ALL_Q.length;
  document.getElementById('count-random').textContent = ALL_Q.length + ' Questions';
  updateWrongCount();
  updateAnsweredStats();
  updateStarredCount();
  document.getElementById('stat-best').textContent = BEST ? BEST + '%' : '—';
  setLang('he');
  showScreen('home');
}

window._questionsReady = false;
window._authReady      = false;

function showScreen(id) {
  ['loading','home','config','exam-config','streak-config','quiz','results','stats-page','about-page','saved-page','flashcards-page','glossary-game-page','match-game-page'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo(0, 0);
  const nav = document.getElementById('global-nav');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const logoBar = document.getElementById('top-logo-bar');
  const noNav = ['loading','config','exam-config','streak-config','quiz','results'];
  const hide = noNav.includes(id);
  if (nav) {
    nav.classList.toggle('hidden-nav', hide);
    if (toggleBtn) toggleBtn.style.display = hide ? 'none' : 'flex';
  }
  const showLogo = ['stats-page','about-page','saved-page','flashcards-page','glossary-game-page','match-game-page'].includes(id);
  if (logoBar) logoBar.classList.toggle('hidden', !showLogo);
  const guestBanner = document.getElementById('login-wall');
  if (guestBanner && !window._currentUser) {
    guestBanner.classList.toggle('hidden', id !== 'home');
  }
}

function toggleSidebar() {
  const nav = document.getElementById('global-nav');
  const btn = document.getElementById('sidebar-toggle-btn');
  const isCollapsed = nav.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  if (btn) btn.textContent = isCollapsed ? '☰' : '✕';
  if (btn) btn.style.right = isCollapsed ? '1rem' : '80px';
}

function navTo(page) {
  showScreen(page);
  ['home','stats-page','about-page','saved-page','flashcards-page','glossary-game-page','match-game-page'].forEach(p => {
    const key = p === 'home' ? 'nav-home'
              : p === 'stats-page' ? 'nav-stats'
              : p === 'about-page' ? 'nav-about'
              : p === 'saved-page' ? 'nav-saved'
              : 'nav-flash';
    const btn = document.getElementById(key);
    if (btn) btn.classList.toggle('active', p === page);
  });
  if (page === 'stats-page') updateStatsPage();
  if (page === 'saved-page') updateSavedPage();
  if (page === 'flashcards-page') initFlashcards();
}

function updateStatsPage() {
  const total = ACTIVE_Q.length || 0;
  // Basic stats
  const el = (id) => document.getElementById(id);
  if (el('sp-best'))        el('sp-best').textContent        = BEST ? BEST + '%' : '—';
  if (el('sp-unique'))      el('sp-unique').textContent      = UNIQUE_IDS.length;
  if (el('sp-answered'))    el('sp-answered').textContent    = ANSWERED_IDS.length;
  if (el('sp-wrong-count')) el('sp-wrong-count').textContent = WRONG_IDS.length;
  if (el('sp-total'))       el('sp-total').textContent       = total;
  if (el('sp-quizzes'))     el('sp-quizzes').textContent     = QUIZ_HISTORY.length;

  // Coverage
  const coverage = total > 0 ? Math.round((UNIQUE_IDS.length / total) * 100) : 0;
  if (el('sp-coverage'))     el('sp-coverage').textContent    = coverage + '%';
  if (el('sp-coverage-bar')) el('sp-coverage-bar').style.width = coverage + '%';

  // Accuracy from history
  if (QUIZ_HISTORY.length > 0) {
    const totalCorrect  = QUIZ_HISTORY.reduce((s, q) => s + (q.correct || 0), 0);
    const totalAnswered = QUIZ_HISTORY.reduce((s, q) => s + (q.total  || 0), 0);
    const acc = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    const wrongPct = 100 - acc;
    if (el('sp-accuracy'))  el('sp-accuracy').textContent  = acc + '%';
    if (el('sp-wrong-pct')) el('sp-wrong-pct').textContent = wrongPct + '%';
  }

  // History list
  const histEl = el('sp-history');
  if (histEl) {
    if (QUIZ_HISTORY.length === 0) {
      histEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:1rem">עדיין אין היסטוריה — השלם חידון כדי להתחיל</div>';
    } else {
      const modeNames = { random: '🎲 אקראי', exam: '📋 סימולציה', wrong: '⚡ שגיאות', source: '📚 לפי מקור', speed: '⚡ מהירות', streak: '🔥 רצף' };
      histEl.innerHTML = [...QUIZ_HISTORY].reverse().map(h => {
        const d = new Date(h.date);
        const dateStr = d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'});
        const pass = h.passed;

        // Sources
        const srcLine = (h.sources && h.sources.length > 0)
          ? `<div class="hi-detail">📚 ${h.sources.join(', ')}</div>`
          : '';

        // K-levels
        const kLine = (h.kLevels && h.kLevels.length > 0)
          ? `<div class="hi-detail">🎯 ${h.kLevels.join(' · ')}</div>`
          : '';

        // Duration (only for exam mode)
        const durLine = (h.mode === 'exam' && h.duration != null)
          ? (() => {
              const m = Math.floor(h.duration / 60);
              const s = h.duration % 60;
              return `<div class="hi-detail">⏱️ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} דקות</div>`;
            })()
          : '';

        return `<div class="history-item">
          <div class="hi-score ${pass ? 'pass' : 'fail'}">${h.score}%</div>
          <div class="hi-meta">
            <div>${modeNames[h.mode] || h.mode} · ${h.correct}/${h.total} נכון</div>
            ${srcLine}${kLine}${durLine}
            <div style="font-size:0.72rem;margin-top:0.2rem">${dateStr}</div>
          </div>
          <div class="hi-badge ${pass ? 'pass' : 'fail'}">${pass ? 'עבר' : 'נכשל'}</div>
        </div>`;
      }).join('');
    }
  }
}

async function clearAllStats() {
  if (!confirm('האם אתה בטוח? פעולה זו תמחק את כל הסטטיסטיקות שלך!')) return;
  WRONG_IDS    = [];
  BEST         = null;
  ANSWERED_IDS = [];
  UNIQUE_IDS   = [];
  QUIZ_HISTORY = [];
  // STARRED_IDS and NOTES are intentionally preserved
  updateWrongCount();
  updateAnsweredStats();
  updateStarredCount();
  updateStatsPage();
  const bestEl = document.getElementById('stat-best');
  if (bestEl) bestEl.textContent = '—';
  await persistData();
  if (window._fbClearHistory && window._currentUser) {
    window._fbClearHistory().catch(console.error);
  }
}

function startMode(mode) {
  SESSION.mode = mode;
  const he = CURRENT_LANG === 'he';
  SPEED_MODE = (mode === 'speed');

  if (mode === 'random' || mode === 'speed') {
    document.getElementById('config-title').textContent = mode === 'speed'
      ? (he ? '⚡🔥 שאלות על זמן' : '⚡🔥 Speed Mode')
      : (he ? '🎲 חידון אקראי' : '🎲 Random Quiz');

    // Slider: 5,10,...,40 are real values; 45 = "∞ הכל"
    const rng = document.getElementById('rng-count');
    const lbl = document.getElementById('lbl-count');
    if (rng) {
      rng.min = 5; rng.max = 45; rng.step = 5;
      const cur = Math.min(Math.max(5, parseInt(rng.value) || 20), 45);
      rng.value = cur;
      if (lbl) lbl.textContent = cur >= 45 ? '∞ הכל' : cur;
      rng.oninput = function() {
        const v = parseInt(this.value);
        if (lbl) lbl.textContent = v >= 45 ? '∞ הכל' : v;
      };
    }

    // Speed timer slider (only for speed mode)
    const timerWrap = document.getElementById('speed-timer-config');
    if (timerWrap) {
      timerWrap.classList.toggle('hidden', mode !== 'speed');
      if (mode === 'speed') {
        const timerRng = document.getElementById('rng-speed-timer');
        const timerLbl = document.getElementById('lbl-speed-timer');
        if (timerRng) {
          timerRng.value = SPEED_SECONDS;
          if (timerLbl) timerLbl.textContent = SPEED_SECONDS + (he ? ' שנ׳' : 's');
          timerRng.oninput = function() {
            SPEED_SECONDS = parseInt(this.value);
            if (timerLbl) timerLbl.textContent = SPEED_SECONDS + (he ? ' שנ׳' : 's');
          };
        }
      }
    }

    showScreen('config');
  } else if (mode === 'exam') {
    showScreen('exam-config');
  } else if (mode === 'streak') {
    showScreen('streak-config');
  } else if (mode === 'wrong') {
    const wqs = ACTIVE_Q.filter((q, i) => WRONG_IDS.includes(i));
    if (wqs.length === 0) {
      alert(he ? 'אין שאלות שגויות עדיין!' : 'No wrong answers recorded yet!');
      return;
    }
    runQuiz(shuffle(wqs));
  } else if (mode === 'starred') {
    const notedIdxs = Object.keys(NOTES).map(Number).filter(n => !isNaN(n));
    const combinedIdxs = [...new Set([...STARRED_IDS, ...notedIdxs])];
    const sqs = ACTIVE_Q.filter((q, i) => combinedIdxs.includes(i));
    if (sqs.length === 0) {
      alert(he ? 'אין שאלות מסומנות או עם הערות עדיין!' : 'No starred or noted questions yet!');
      return;
    }
    runQuiz(shuffle(sqs));
  }
}


// ── Get selected source values from checkboxes ──
window.getSelectedSources = function(he) {
  const lang = he ? 'he' : 'en';
  const allCb = document.getElementById('src-all-' + lang);
  if (allCb && allCb.checked) return []; // empty = all
  return [...document.querySelectorAll('.src-cb-' + lang + ':checked')].map(cb => cb.value);
};

window.toggleAllSources = function(lang, checked) {
  document.querySelectorAll('.src-cb-' + lang).forEach(cb => cb.checked = checked);
};

// Sync "all" checkbox when individual ones change
document.addEventListener('change', function(e) {
  if (e.target.classList.contains('src-cb')) {
    const lang = e.target.classList.contains('src-cb-he') ? 'he' : 'en';
    const allCbs = document.querySelectorAll('.src-cb-' + lang);
    const allChecked = [...allCbs].every(cb => cb.checked);
    const allCb = document.getElementById('src-all-' + lang);
    if (allCb) allCb.checked = allChecked;
  }
});

// ── Exam source checkboxes toggle ──
window.toggleAllExamSources = function(checked) {
  document.querySelectorAll('.exam-src-cb').forEach(cb => cb.checked = false);
  document.getElementById('exam-src-all').checked = checked;
};

document.addEventListener('change', function(e) {
  if (e.target.classList.contains('exam-src-cb')) {
    const anyCbChecked = [...document.querySelectorAll('.exam-src-cb')].some(cb => cb.checked);
    document.getElementById('exam-src-all').checked = !anyCbChecked;
  }
});

// ── Build exam question pool with K-level distribution ──
function buildExamPool() {
  const he = CURRENT_LANG === 'he';
  const allCb = document.getElementById('exam-src-all');
  const selectedSrcs = allCb && allCb.checked
    ? []
    : [...document.querySelectorAll('.exam-src-cb:checked')].map(cb => cb.value);

  // Exclude keyword quiz questions
  let pool = ACTIVE_Q.filter(q => !q.src || !q.src.includes('מילות מפתח') && !q.src.includes('keyword') && !q.src.includes('Keyword'));

  if (selectedSrcs.length === 1) {
    // Single source: use all 40 from that source (already K-distributed correctly)
    pool = pool.filter(q => q.src === selectedSrcs[0]);
    return shuffle(pool).slice(0, 40);
  }

  // Multiple sources (or all): pick without duplicates, enforce K-level distribution
  // Deduplicate by question text (normalize whitespace)
  const normalize = s => s ? s.replace(/\s+/g, ' ').trim() : '';
  const seen = new Set();
  const uniquePool = pool.filter(q => {
    const key = normalize(q.q);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter by selected sources
  const srcFiltered = selectedSrcs.length === 0 ? uniquePool : uniquePool.filter(q => selectedSrcs.includes(q.src));

  // Partition by K level
  const k1Pool = shuffle(srcFiltered.filter(q => (q.k_level || q.k) === 'K1'));
  const k2Pool = shuffle(srcFiltered.filter(q => (q.k_level || q.k) === 'K2'));
  const k3Pool = shuffle(srcFiltered.filter(q => (q.k_level || q.k) === 'K3'));

  // Target: K1=8, K2=24, K3=8
  const picked = [
    ...k1Pool.slice(0, 8),
    ...k2Pool.slice(0, 24),
    ...k3Pool.slice(0, 8)
  ];

  if (picked.length < 40) {
    // If not enough K-level questions, fill from remaining
    const pickedSet = new Set(picked);
    const rest = shuffle(srcFiltered.filter(q => !pickedSet.has(q)));
    picked.push(...rest.slice(0, 40 - picked.length));
  }

  return shuffle(picked.slice(0, 40));
}

window.beginExam = function() {
  const questions = buildExamPool();
  if (questions.length === 0) {
    alert('אין שאלות מתאימות לפי הסינון שנבחר.');
    return;
  }
  runQuiz(questions);
};

function beginQuiz() {
  const he = CURRENT_LANG === 'he';
  const selectedSrcs = getSelectedSources(he);
  const klevel = document.getElementById('sel-klevel').value;
  const rng = document.getElementById('rng-count');
  const count = parseInt(rng.value);
  const useAll = count >= 45;
  const order = document.getElementById('sel-order').value;
  let pool = selectedSrcs.length === 0 ? ACTIVE_Q : ACTIVE_Q.filter(q => selectedSrcs.includes(q.src));
  if (klevel !== 'all') pool = pool.filter(q => (q.k_level || q.k) === klevel);
  if (pool.length === 0) {
    alert(he ? 'אין שאלות התואמות את הסינון שנבחר.' : 'No questions match the selected filters.');
    return;
  }
  if (order === 'shuffle') pool = shuffle(pool);
  runQuiz(useAll ? pool : pool.slice(0, count));
}

function runQuiz(questions) {
  // answers array: null = unanswered, object = answered/skipped
  SESSION = { questions, idx: 0, correct: 0, wrong: 0, skipped: 0, answers: new Array(questions.length).fill(null), mode: SESSION.mode };
  clearSpeedTimer();
  clearExamTimer();
  showScreen('quiz');
  // Show/hide speed timer bar
  document.getElementById('speed-timer-wrap').classList.toggle('hidden', !SPEED_MODE);
  // Show/hide exam timer
  const examTimerWrap = document.getElementById('exam-timer-wrap');
  if (examTimerWrap) examTimerWrap.classList.toggle('hidden', SESSION.mode !== 'exam');
  // Show/hide exam nav bar
  const examNavBar = document.getElementById('exam-nav-bar');
  if (examNavBar) examNavBar.classList.toggle('hidden', SESSION.mode !== 'exam');
  if (SESSION.mode === 'exam') renderExamNavBar();
  renderQuestion();
}

// ── Exam navigation bar ──
function renderExamNavBar() {
  const bar = document.getElementById('exam-nav-pills');
  if (!bar) return;
  bar.innerHTML = '';
  SESSION.questions.forEach((q, i) => {
    const pill = document.createElement('button');
    pill.textContent = i + 1;
    pill.style.cssText = `min-width:28px;height:28px;border-radius:6px;border:none;cursor:pointer;font-size:0.75rem;font-weight:700;font-family:'Space Mono',monospace;transition:all 0.15s;padding:0 4px;`;
    const ans = SESSION.answers[i];
    if (i === SESSION.idx) {
      pill.style.background = 'var(--accent)';
      pill.style.color = '#fff';
    } else if (ans === null) {
      pill.style.background = 'var(--border)';
      pill.style.color = 'var(--muted)';
    } else if (ans.skipped) {
      pill.style.background = 'var(--warning)';
      pill.style.color = '#fff';
    } else if (ans.correct) {
      pill.style.background = 'var(--success)';
      pill.style.color = '#fff';
    } else {
      pill.style.background = 'var(--error)';
      pill.style.color = '#fff';
    }
    // Only allow navigation to answered/skipped questions or current
    const canNav = ans !== null || i === SESSION.idx;
    if (canNav) {
      pill.onclick = () => navigateToExamQuestion(i);
      pill.title = ans === null ? 'שאלה נוכחית' : (ans.skipped ? 'דולג — לחץ לחזרה' : (ans.correct ? 'נכון' : 'שגוי'));
    } else {
      pill.style.cursor = 'default';
      pill.style.opacity = '0.7';
    }
    bar.appendChild(pill);
  });
}

function navigateToExamQuestion(idx) {
  if (idx === SESSION.idx) return;
  const ans = SESSION.answers[idx];
  // Can only navigate to already-answered/skipped questions
  if (ans === null) return;
  SESSION.idx = idx;
  renderQuestion();
}

window.goBackExam = function() {
  // Find the previous answered/skipped question
  for (let i = SESSION.idx - 1; i >= 0; i--) {
    if (SESSION.answers[i] !== null) {
      SESSION.idx = i;
      renderQuestion();
      return;
    }
  }
};

window.finishExam = function() {
  const he = CURRENT_LANG === 'he';
  const unanswered = SESSION.answers.filter(a => a === null).length;
  if (unanswered > 0) {
    if (!confirm(he ? `נותרו ${unanswered} שאלות ללא מענה. לסיים בחינה?` : `${unanswered} questions unanswered. Finish exam?`)) return;
    // Mark remaining unanswered as skipped
    SESSION.answers.forEach((a, i) => {
      if (a === null) {
        SESSION.answers[i] = { q: SESSION.questions[i], chosen: -1, correct: false, skipped: true };
        SESSION.skipped++;
      }
    });
  }
  showResults();
};


function renderQuestion() {
  const q = SESSION.questions[SESSION.idx];
  const total = SESSION.questions.length;

  document.getElementById('progress-fill').style.width = (SESSION.idx / total * 100) + '%';
  document.getElementById('prog-text').textContent = `${SESSION.idx + 1} / ${total}`;
  document.getElementById('score-live').textContent = `✓ ${SESSION.correct} · ✗ ${SESSION.wrong}`;

  const meta = document.getElementById('q-meta');
  const examLinks = EXAM_LINKS[q.src];
  let metaHtml = `<span class="tag tag-src">${q.src}</span>`;
  if (q.q_num) metaHtml += `<span class="tag tag-qnum">שאלה ${q.q_num}</span>`;
  if (q.k)     metaHtml += `<span class="tag tag-k">${q.k}</span>`;
  if (q.k_level) metaHtml += `<span class="tag tag-k">${q.k_level}</span>`;
  if (examLinks) {
    metaHtml += `<a class="tag tag-link" href="${examLinks.questions}" target="_blank" rel="noopener">📄 שאלות</a>`;
    metaHtml += `<a class="tag tag-link answers" href="${examLinks.answers}" target="_blank" rel="noopener">✅ תשובות</a>`;
  }
  meta.innerHTML = metaHtml;

  const qTextEl = document.getElementById('q-text');
  if (q.img) {
    // Split question text at the last line ending with ':' before the image
    const lines = q.q.split('\n');
    let splitIdx = lines.length; // default: image at end
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().endsWith(':')) { splitIdx = i + 1; break; }
    }
    const textBefore = lines.slice(0, splitIdx).join('\n');
    const textAfter  = lines.slice(splitIdx).join('\n').trim();
    const imgHtml = `<img src="${q.img}" alt="" style="max-width:100%;border-radius:8px;margin:0.5rem 0;display:block">`;
    qTextEl.innerHTML = formatQuestion(textBefore) + imgHtml + (textAfter ? formatQuestion(textAfter) : '');
  } else {
    qTextEl.innerHTML = formatQuestion(q.q);
  }
  // Clear any leftover img element
  const oldImgEl = document.getElementById('q-img');
  if (oldImgEl) oldImgEl.remove();

  // Star button state
  const gIdx = ACTIVE_Q.indexOf(q);
  const isStarred = gIdx >= 0 && STARRED_IDS.includes(gIdx);
  const starBtn = document.getElementById('btn-star');
  starBtn.textContent = isStarred ? '⭐' : '☆';
  starBtn.style.color = isStarred ? '#ffd166' : 'var(--muted)';

  // Note — always visible, load existing value
  const noteInput = document.getElementById('note-input');
  const noteKey = String(gIdx >= 0 ? gIdx : 'tmp');
  noteInput.value = NOTES[noteKey] || '';

  const opts = document.getElementById('options');
  opts.innerHTML = '';
  const _heLetters = ['א','ב','ג','ד','ה','ו'];
  const _enLetters = ['A','B','C','D','E','F'];
  const _letters = CURRENT_LANG === 'he' ? _heLetters : _enLetters;
  const isMulti = Array.isArray(q.ans);
  _enLetters.slice(0, q.opts.length).forEach((letter, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.dataset.idx = i;
    btn.innerHTML = `<span class="opt-letter">${_letters[i]}</span><span class="opt-text">${q.opts[i]}</span>`;
    if (isMulti) {
      btn.onclick = () => toggleMultiOption(btn, q);
    } else {
      btn.onclick = () => selectOption(i);
    }
    opts.appendChild(btn);
  });
  if (isMulti) {
    const need = q.multi || q.ans.length;
    const hint = document.createElement('div');
    hint.className = 'multi-hint';
    hint.textContent = CURRENT_LANG === 'he' ? 'בחרו שתי אפשרויות' : 'Select two options';
    opts.insertBefore(hint, opts.firstChild);
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'multi-confirm';
    confirmBtn.className = 'option multi-confirm';
    confirmBtn.disabled = true;
    confirmBtn.textContent = CURRENT_LANG === 'he' ? `✓ אשר בחירה` : `✓ Confirm`;
    confirmBtn.onclick = () => submitMultiAnswer(q);
    opts.appendChild(confirmBtn);
  }

  const exp = document.getElementById('explanation');
  exp.classList.add('hidden');
  exp.innerHTML = '';

  // Update exam nav bar
  if (SESSION.mode === 'exam') renderExamNavBar();

  // Check if this question was already answered (exam navigation)
  const existingAnswer = SESSION.answers[SESSION.idx];
  const isAnswered = existingAnswer !== null;
  const isExam = SESSION.mode === 'exam';

  if (isAnswered && isExam && !existingAnswer.skipped) {
    // Answered (not skipped) — show in read-only state with correct/wrong highlighted
    const allOptBtns = opts.querySelectorAll('.option:not(.multi-confirm)');
    allOptBtns.forEach(b => b.classList.add('disabled'));

    // Was answered — restore visual state
    if (existingAnswer.chosenMulti) {
      allOptBtns.forEach(b => {
        const i = parseInt(b.dataset.idx);
        const wasChosen = existingAnswer.chosenMulti.includes(i);
        const correct = Array.isArray(q.ans) ? q.ans : [q.ans];
        const isAns = correct.includes(i);
        if (wasChosen && isAns) b.classList.add('correct');
        else if (wasChosen) b.classList.add('wrong');
        else if (isAns) b.classList.add('correct');
      });
    } else {
      const chosenBtn = opts.children[existingAnswer.chosen];
      if (chosenBtn) chosenBtn.classList.add(existingAnswer.correct ? 'correct' : 'wrong');
      if (!existingAnswer.correct && !Array.isArray(q.ans)) {
        const correctBtn = opts.children[q.ans];
        if (correctBtn) correctBtn.classList.add('correct');
      }
    }

    if (q.exp) {
      exp.innerHTML = `<strong>${CURRENT_LANG === 'he' ? 'הסבר' : 'Explanation'}</strong>${formatExplanation(q.exp, q.ans)}`;
      exp.classList.remove('hidden');
    }

    // Footer: back button + "continue to next unanswered" button
    document.getElementById('btn-skip').classList.add('hidden');
    document.getElementById('btn-next').classList.add('hidden');
    updateExamFooter();
  } else {
    // Unanswered or previously skipped — show as fully answerable
    // (skipped state will be cleared when user actually submits an answer)
    document.getElementById('btn-skip').classList.remove('hidden');
    document.getElementById('btn-next').classList.add('hidden');
    updateExamFooter();
  }

  const card = document.getElementById('q-card');
  card.style.animation = 'none';
  card.offsetHeight;
  card.style.animation = '';

  // Start speed timer if in speed mode
  if (SPEED_MODE) startSpeedTimer();
  // Start exam timer if in exam mode (only on first question of the session)
  if (SESSION.mode === 'exam' && EXAM_TIMER_INTERVAL === null) startExamTimer();
}

function updateExamFooter() {
  if (SESSION.mode !== 'exam') {
    document.getElementById('btn-back-exam').classList.add('hidden');
    document.getElementById('btn-finish-exam').classList.add('hidden');
    return;
  }

  const existingAnswer = SESSION.answers[SESSION.idx];
  const isAnswered = existingAnswer !== null;

  // Back button: show if there's a previous answered question
  const hasPrev = SESSION.answers.slice(0, SESSION.idx).some(a => a !== null);
  document.getElementById('btn-back-exam').classList.toggle('hidden', !hasPrev);

  // Finish button: show only when all questions are answered
  const allAnswered = SESSION.answers.every(a => a !== null);
  document.getElementById('btn-finish-exam').classList.toggle('hidden', !allAnswered);

  // "Next unanswered" button: show when viewing an already-answered question and there are still unanswered ones
  const hasUnanswered = SESSION.answers.some(a => a === null);
  const btnNext = document.getElementById('btn-next');
  if (isAnswered && hasUnanswered) {
    // Repurpose btn-next as "continue to next unanswered"
    btnNext.classList.remove('hidden');
    btnNext.textContent = 'המשך ←';
    btnNext.onclick = advanceOrFinish;
  } else if (!isAnswered) {
    // Fresh unanswered question — skip/next handled by answer logic
    btnNext.classList.add('hidden');
  } else {
    // All answered, just show finish
    btnNext.classList.add('hidden');
  }
}

function toggleMultiOption(btn, q) {
  const need = q.multi || q.ans.length;
  const allBtns = document.querySelectorAll('.option:not(.multi-confirm)');
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
  } else {
    const selected = document.querySelectorAll('.option.selected');
    if (selected.length >= need) return; // already at max
    btn.classList.add('selected');
  }
  const confirmBtn = document.getElementById('multi-confirm');
  if (confirmBtn) {
    const selected = document.querySelectorAll('.option.selected');
    confirmBtn.disabled = selected.length !== need;
  }
}

async function submitMultiAnswer(q) {
  const selectedBtns = document.querySelectorAll('.option.selected');
  const chosen = Array.from(selectedBtns).map(b => parseInt(b.dataset.idx)).sort((a,b)=>a-b);
  const correct = [...q.ans].sort((a,b)=>a-b);
  const isCorrect = JSON.stringify(chosen) === JSON.stringify(correct);

  // If this question was previously skipped, undo that skip count
  if (SESSION.answers[SESSION.idx]?.skipped) {
    SESSION.skipped = Math.max(0, SESSION.skipped - 1);
    SESSION.answers[SESSION.idx] = null;
  }

  const allBtns = document.querySelectorAll('.option:not(.multi-confirm)');
  allBtns.forEach(b => b.classList.add('disabled'));
  const confirmBtn = document.getElementById('multi-confirm');
  if (confirmBtn) confirmBtn.classList.add('disabled');

  // Mark correct/wrong
  allBtns.forEach(b => {
    const i = parseInt(b.dataset.idx);
    const wasChosen = chosen.includes(i);
    const isAns = correct.includes(i);
    if (wasChosen && isAns)  b.classList.add('correct');
    else if (wasChosen)       b.classList.add('wrong');
    else if (isAns)           b.classList.add('correct');
  });

  clearSpeedTimer();
  const gIdx = ACTIVE_Q.indexOf(q);
  if (gIdx >= 0) {
    ANSWERED_IDS.push(gIdx);
    if (!UNIQUE_IDS.includes(gIdx)) UNIQUE_IDS.push(gIdx);
  }
  if (isCorrect) {
    SESSION.correct++;
    SESSION.answers[SESSION.idx] = { q, chosen: chosen[0], correct: true, chosenMulti: chosen };
    SFX.correct();
    if (SESSION.mode === 'streak') streakOnCorrect();
  } else {
    SESSION.wrong++;
    SESSION.answers[SESSION.idx] = { q, chosen: chosen[0], correct: false, chosenMulti: chosen };
    if (gIdx >= 0 && !WRONG_IDS.includes(gIdx)) WRONG_IDS.push(gIdx);
    SFX.wrong();
    if (SESSION.mode === 'streak') { setTimeout(streakGameOver, 2500); return; }
  }

  await persistData();
  updateAnsweredStats();

  if (q.exp) {
    const exp = document.getElementById('explanation');
    exp.innerHTML = `<strong>${CURRENT_LANG === 'he' ? 'הסבר' : 'Explanation'}</strong>${formatExplanation(q.exp, q.ans)}`;
    exp.classList.remove('hidden');
  }
  document.getElementById('btn-skip').classList.add('hidden');
  document.getElementById('btn-next').classList.remove('hidden');
  document.getElementById('score-live').textContent = `✓ ${SESSION.correct} · ✗ ${SESSION.wrong}`;
  updateExamFooter();
  if (SESSION.mode === 'exam') renderExamNavBar();
}

async function selectOption(idx) {
  const opts = document.querySelectorAll('.option');
  if (opts[0].classList.contains('disabled')) return;

  clearSpeedTimer();

  const q = SESSION.questions[SESSION.idx];
  opts.forEach(o => o.classList.add('disabled'));

  // If this question was previously skipped, undo that skip count
  if (SESSION.answers[SESSION.idx]?.skipped) {
    SESSION.skipped = Math.max(0, SESSION.skipped - 1);
    SESSION.answers[SESSION.idx] = null;
  }

  // Track answered stats
  const gIdx = ACTIVE_Q.indexOf(q);
  if (gIdx >= 0) {
    ANSWERED_IDS.push(gIdx);
    if (!UNIQUE_IDS.includes(gIdx)) UNIQUE_IDS.push(gIdx);
  }

  if (idx === q.ans) {
    opts[idx].classList.add('correct');
    SESSION.correct++;
    SESSION.answers[SESSION.idx] = { q, chosen: idx, correct: true };
    SFX.correct();
    if (SESSION.mode === 'streak') streakOnCorrect();
  } else {
    opts[idx].classList.add('wrong');
    opts[q.ans].classList.add('correct');
    SESSION.wrong++;
    SESSION.answers[SESSION.idx] = { q, chosen: idx, correct: false };
    const globalIdx = ACTIVE_Q.indexOf(q);
    if (globalIdx >= 0 && !WRONG_IDS.includes(globalIdx)) {
      WRONG_IDS.push(globalIdx);
    }
    SFX.wrong();
    if (SESSION.mode === 'streak') { setTimeout(streakGameOver, 2500); return; }
  }

  await persistData();
  updateAnsweredStats();

  if (q.exp) {
    const exp = document.getElementById('explanation');
    const _expHe = CURRENT_LANG === 'he';
    exp.innerHTML = `<strong>${_expHe ? 'הסבר' : 'Explanation'}</strong>${formatExplanation(q.exp, q.ans)}`;
    exp.classList.remove('hidden');
  }

  document.getElementById('btn-skip').classList.add('hidden');
  document.getElementById('btn-next').classList.remove('hidden');
  document.getElementById('score-live').textContent = `✓ ${SESSION.correct} · ✗ ${SESSION.wrong}`;
  updateExamFooter();
  if (SESSION.mode === 'exam') renderExamNavBar();
}

function reportQuestion() {
  const q = SESSION.questions?.[SESSION.idx];
  if (!q) return;

  const qNum   = q.q_num || (ACTIVE_Q.indexOf(q) + 1);
  const src    = q.src || '';

  // Extract exam letter from src e.g. "בחינה לדוגמא גרסה א'" → "א'"
  const letterMatch = src.match(/גרסה\s+([\u05d0-\u05ea]'?)/);
  const examLetter  = letterMatch ? letterMatch[1] : src;

  const subject = `בעיה בשאלה מס ${qNum} מתוך בחינה לדוגמא ${examLetter}`;
  const body    = `שלום,\n\nמצאתי בעיה בשאלה מס ${qNum} מתוך בחינה לדוגמא ${examLetter}.\n\nתיאור הבעיה:\n[פרט כאן את הבעיה]\n`;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = `mailto:tomer9tomer@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } else {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=tomer9tomer%40gmail.com&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  }
}

function reportGeneral() {
  const subject = `דיווח על בעיה כללית – ISTQB Practice`;
  const body =
    `שלום,\n\nרציתי לדווח על בעיה כללית באתר.\n\n` +
    `סוג הבעיה (מחק את הלא רלוונטי):\n` +
    `[ ] באג / תקלה טכנית\n` +
    `[ ] בעיה בעיצוב / תצוגה\n` +
    `[ ] בעיה בהתחברות / שמירת נתונים\n` +
    `[ ] הצעה לשיפור\n` +
    `[ ] אחר\n\n` +
    `תיאור הבעיה:\n[פרט כאן]\n\n` +
    `דפדפן / מכשיר:\n[לדוגמא: Chrome על Windows / Safari על iPhone]\n`;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = `mailto:tomer9tomer@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } else {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=tomer9tomer%40gmail.com&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  }
}

function skipQuestion() {
  clearSpeedTimer();
  SESSION.skipped++;
  SESSION.answers[SESSION.idx] = { q: SESSION.questions[SESSION.idx], chosen: -1, correct: false, skipped: true };
  advanceOrFinish();
}

function nextQuestion() { SFX.nextQuestion(); advanceOrFinish(); }

function advanceOrFinish() {
  if (SESSION.mode === 'exam') {
    // In exam mode: find next unanswered question
    const total = SESSION.questions.length;
    let next = -1;
    // First look forward from current
    for (let i = SESSION.idx + 1; i < total; i++) {
      if (SESSION.answers[i] === null) { next = i; break; }
    }
    // If none found forward, wrap around from start
    if (next === -1) {
      for (let i = 0; i < SESSION.idx; i++) {
        if (SESSION.answers[i] === null) { next = i; break; }
      }
    }
    if (next === -1) {
      // All answered
      showResults();
    } else {
      SESSION.idx = next;
      renderQuestion();
    }
  } else {
    SESSION.idx++;
    if (SESSION.idx >= SESSION.questions.length) showResults();
    else renderQuestion();
  }
}

function confirmQuit() {
  const _quitHe = CURRENT_LANG === 'he';
  if (confirm(_quitHe ? 'לצאת מהחידון?' : 'Quit this quiz?')) showScreen('home');
}

async function showResults() {
  clearExamTimer();
  showScreen('results');
  const total = SESSION.questions.length;
  // Recalculate from answers array (handles exam navigation edge cases)
  SESSION.correct = SESSION.answers.filter(a => a && a.correct).length;
  SESSION.wrong   = SESSION.answers.filter(a => a && !a.correct && !a.skipped).length;
  SESSION.skipped = SESSION.answers.filter(a => a && a.skipped).length;
  const pct = Math.round((SESSION.correct / total) * 100);
  const pass = pct >= 65;
  const he = CURRENT_LANG === 'he';

  setTimeout(() => pass ? SFX.quizWin() : SFX.quizFail(), 300);

  if (!BEST || pct > BEST) {
    BEST = pct;
    await persistData();
    document.getElementById('stat-best').textContent = BEST + '%';
  }

  document.getElementById('res-pct').textContent = pct + '%';
  document.getElementById('res-pct').style.color = pass ? 'var(--success)' : 'var(--error)';
  document.getElementById('score-circle').style.background =
    `conic-gradient(${pass ? 'var(--success)' : 'var(--error)'} ${pct * 3.6}deg, var(--border) 0)`;
  document.getElementById('res-title').textContent = pass
    ? (he ? '🎉 כל הכבוד!' : '🎉 Great Work!')
    : (he ? '📖 המשך ללמוד' : '📖 Keep Studying');
  document.getElementById('res-sub').textContent = he
    ? `ענית נכון על ${SESSION.correct} מתוך ${total} שאלות.`
    : `You scored ${SESSION.correct} out of ${total} questions.`;

  const passBadge = document.getElementById('res-pass');
  passBadge.textContent = pass
    ? (he ? '✓ עבר (≥65%)' : '✓ PASS (≥65%)')
    : (he ? '✗ נכשל (<65%)' : '✗ FAIL (<65%)');
  passBadge.className = 'pass-badge ' + (pass ? 'pass' : 'fail');

  document.getElementById('rs-correct').textContent = SESSION.correct;
  document.getElementById('rs-wrong').textContent = SESSION.wrong;
  document.getElementById('rs-skipped').textContent = SESSION.skipped;
  document.getElementById('btn-retry-wrong').style.display = SESSION.wrong > 0 ? '' : 'none';

  // Update result labels for language
  const rstatLabels = document.querySelectorAll('#results .rstat-label');
  if (rstatLabels.length >= 3) {
    rstatLabels[0].textContent = he ? 'נכון' : 'Correct';
    rstatLabels[1].textContent = he ? 'שגוי' : 'Wrong';
    rstatLabels[2].textContent = he ? 'דולג' : 'Skipped';
  }
  const scoreLabel = document.querySelector('#results .score-label');
  if (scoreLabel) scoreLabel.textContent = he ? 'ציון' : 'Score';

  buildReview();
  document.getElementById('review-section').classList.add('hidden');
  updateWrongCount();

  // Save quiz to local history + cloud
  const _sessionSrcs = [...new Set(SESSION.questions.map(q => q.src).filter(Boolean))];
  const _sessionKs   = [...new Set(SESSION.questions.map(q => q.k_level || q.k).filter(Boolean))].sort();
  const _examDuration = (SESSION.mode === 'exam' && EXAM_START_TIME)
    ? Math.round((Date.now() - EXAM_START_TIME) / 1000)
    : null;
  const historyEntry = {
    date: new Date().toISOString(),
    mode: SESSION.mode,
    total: total,
    correct: SESSION.correct,
    wrong: SESSION.wrong,
    skipped: SESSION.skipped,
    score: pct,
    passed: pass,
    sources:  _sessionSrcs,
    kLevels:  _sessionKs,
    duration: _examDuration
  };
  QUIZ_HISTORY.push(historyEntry);
  if (window._fbSaveQuizHistory && window._currentUser) {
    window._fbSaveQuizHistory(historyEntry).catch(console.error);
  }
}

function toggleReview() {
  document.getElementById('review-section').classList.toggle('hidden');
}

function buildReview() {
  const list = document.getElementById('review-list');
  list.innerHTML = '';
  const letters = CURRENT_LANG === 'he' ? ['א','ב','ג','ד','ה','ו'] : ['A','B','C','D','E','F'];
  const he = CURRENT_LANG === 'he';
  SESSION.answers.forEach((a, i) => {
    if (!a) return; // skip null (shouldn't happen after showResults, but safety check)
    const div = document.createElement('div');
    div.className = 'review-item ' + (a.correct ? 'correct-item' : 'wrong-item');
    let answerLine = '';
    if (a.skipped) {
      answerLine = `<span style="color:var(--warning)">⊘ ${he ? 'דולג' : 'Skipped'}</span>`;
    } else {
      // Multi-answer question
      if (a.chosenMulti && Array.isArray(a.chosenMulti)) {
        const chosenLines = a.chosenMulti.map(j => `<div style="margin:2px 0">${letters[j] || '?'}) ${a.q.opts[j] || ''}</div>`).join('');
        answerLine = `<div class="${a.correct ? 'review-correct' : 'review-wrong'}" style="margin-bottom:${a.correct ? '0' : '6px'}">
          <span style="font-weight:600">${a.correct ? '\u2713' : '\u2717'} ${he ? '\u05ea\u05e9\u05d5\u05d1\u05d5\u05ea\u05d9\u05da' : 'Your answers'}:</span>
          <div style="margin-top:3px;padding-right:0.8rem">${chosenLines}</div>
        </div>`;
        if (!a.correct) {
          const correctArr = Array.isArray(a.q.ans) ? a.q.ans : [a.q.ans];
          const correctLines = correctArr.map(j => `<div style="margin:2px 0">${letters[j] || '?'}) ${a.q.opts[j] || ''}</div>`).join('');
          answerLine += `<div class="review-correct">
            <span style="font-weight:600">\u2713 ${he ? '\u05ea\u05e9\u05d5\u05d1\u05d5\u05ea \u05e0\u05db\u05d5\u05e0\u05d5\u05ea' : 'Correct answers'}:</span>
            <div style="margin-top:3px;padding-right:0.8rem">${correctLines}</div>
          </div>`;
        }
      } else {
        // Single-answer question
        answerLine = `<span class="${a.correct ? 'review-correct' : 'review-wrong'}">
          ${a.correct ? '✓' : '✗'} ${he ? 'תשובתך' : 'Your answer'}: ${letters[a.chosen] || '?'}) ${a.q.opts[a.chosen] || ''}
        </span>`;
        if (!a.correct) {
          const correctIdx = Array.isArray(a.q.ans) ? a.q.ans[0] : a.q.ans;
          answerLine += ` &nbsp; <span class="review-correct">✓ ${he ? 'נכון' : 'Correct'}: ${letters[correctIdx]}) ${a.q.opts[correctIdx]}</span>`;
        }
      }
    }
    div.innerHTML = `
      <div class="review-q"><strong style="color:var(--muted);font-size:0.75rem;font-family:'Space Mono',monospace">${he ? 'ש' : 'Q'}${i+1}</strong> &nbsp; ${formatQuestion(a.q.q)}</div>
      <div class="review-answers">${answerLine}</div>
      ${a.q.exp && !a.correct ? `<div style="margin-top:0.6rem;font-size:0.8rem;color:var(--muted);line-height:1.55">${formatExplanation(a.q.exp)}</div>` : ''}
    `;
    list.appendChild(div);
  });
}

function retryWrong() {
  const wqs = SESSION.answers.filter(a => !a.correct && !a.skipped).map(a => a.q);
  if (wqs.length === 0) return;
  runQuiz(shuffle(wqs));
}

function md2html(text) {
  if (!text) return text;
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function formatQuestion(text) {
  if (!text) return '';

  function escH(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  if (text.includes('\n')) {
    const lines = text.split('\n');
    let html = '';
    let listItems = [];
    let listType = null;
    let inTable = false;
    let tableRows = [];

    function flushTable() {
      if (!tableRows.length) { inTable = false; return; }
      const rows = tableRows;
      tableRows = []; inTable = false;
      const parseRow = r => r.split('|').map(c=>c.trim()).filter((_,i,a)=>i>0&&i<a.length-1);
      let tableHtml = '<table style="border-collapse:collapse;width:auto;margin:0.5rem 0;font-size:0.82rem;direction:rtl">';
      rows.forEach((row, ri) => {
        const cells = parseRow(row);
        const isHeader = ri === 0;
        const rowBg = isHeader ? 'var(--surface)' : (ri % 2 === 0 ? 'var(--surface)' : 'transparent');
        tableHtml += `<tr style="background:${rowBg}">`;
        cells.forEach(c => {
          const tag = isHeader ? 'th' : 'td';
          const style = isHeader
            ? 'padding:0.3rem 0.8rem;border:1px solid var(--border);font-weight:700;text-align:center;color:var(--text);white-space:nowrap'
            : 'padding:0.25rem 0.8rem;border:1px solid var(--border);text-align:center;white-space:nowrap';
          tableHtml += `<${tag} style="${style}">${md2html(c)}</${tag}>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</table>';
      html += tableHtml;
    }

    function flushList() {
      if (inTable) flushTable();
      if (!listItems.length) return;
      if (listType === 'bullet') {
        html += `<ul style="margin:0.4rem 0 0.5rem 1.2rem;line-height:1.9">${listItems.map(li=>`<li>${li}</li>`).join('')}</ul>`;
      } else if (listType === 'numbered') {
        html += `<ol style="margin:0.4rem 0 0.5rem 1.4rem;line-height:1.9">${listItems.map(li=>`<li>${li}</li>`).join('')}</ol>`;
      } else {
        html += `<ul style="margin:0.4rem 0 0.5rem 0;line-height:1.9;list-style:none;padding:0">${listItems.map(li=>`<li style="padding:0.1rem 0">${li}</li>`).join('')}</ul>`;
      }
      listItems = []; listType = null;
    }

    for (let line of lines) {
      line = line.trim();
      if (!line) { flushList(); continue; }
      const bul  = line.match(/^[•\-–]\s+(.+)/);
      const rom  = line.match(/^(i{1,3}v?|vi{0,3}|ix|x)\.\s+(.+)/i);
      const alph = line.match(/^([a-eA-E])\)\s+(.+)/);
      const num  = line.match(/^\d+\.\s+(.+)/);
      if      (bul)  { if (listType && listType!=='bullet')   flushList(); listType='bullet';   listItems.push(md2html(bul[1])); }
      else if (rom)  { if (listType && listType!=='roman')    flushList(); listType='roman';    listItems.push(`<strong>${rom[1]}.</strong> ${md2html(rom[2])}`); }
      else if (alph) { if (listType && listType!=='alpha')    flushList(); listType='alpha';    listItems.push(`<strong>${alph[1]})</strong> ${md2html(alph[2])}`); }
      else if (num)  { if (listType && listType!=='numbered') flushList(); listType='numbered'; listItems.push(md2html(num[1])); }
      else if (line.startsWith('|')) {
        flushList();
        if (!inTable) { inTable = true; tableRows = []; }
        if (!line.replace(/[|\-\s]/g,'')) { /* separator row — skip */ }
        else tableRows.push(line);
      }
      else           { flushList(); html += `<span style="display:block;margin-bottom:0.35rem">${md2html(line)}</span>`; }
    }
    flushList();
    if (inTable) flushTable();
    return html || text;
  }

  if (text.includes('/')) {
    const parts = text.split(/\s*\/\s*/);
    const intro_and_nums = parts[0];
    const letters_part = parts[1] || '';
    const introMatch = intro_and_nums.match(/^(.*?)(?=\s*1\.)/s);
    const intro = introMatch ? introMatch[1].trim() : '';
    const numItems = [...intro_and_nums.matchAll(/(\d+)\.\s*(.*?)(?=\s+\d+\.|$)/g)].map(m=>`<li>${m[2].trim()}</li>`).join('');
    const letItems = letters_part ? [...letters_part.matchAll(/([A-Z])\.\s*(.*?)(?=\s+[A-Z]\.|$)/g)].map(m=>`<li><strong>${m[1]}.</strong> ${m[2].trim()}</li>`).join('') : '';
    let html = '';
    if (intro) html += `<span style="display:block;margin-bottom:0.6rem">${intro}</span>`;
    if (numItems) html += `<ol style="margin:0.4rem 0 0.6rem 1.4rem;line-height:1.8">${numItems}</ol>`;
    if (letItems) html += `<ul style="margin:0 0 0 1.4rem;line-height:1.8;list-style:none">${letItems}</ul>`;
    if (html) return html;
  }

  if (/\s1\.\s/.test(text)) {
    const introMatch = text.match(/^(.*?)(?=\s*1\.)/s);
    const intro = introMatch ? introMatch[1].trim() : '';
    const items = [...text.matchAll(/(\d+)\.\s*(.*?)(?=\s+\d+\.|$)/g)].map(m=>`<li>${m[2].trim()}</li>`).join('');
    if (items) return `${intro?`<span style="display:block;margin-bottom:0.5rem">${intro}</span>`:''}<ol style="margin:0.3rem 0 0 1.4rem;line-height:1.8">${items}</ol>`;
  }

  return md2html(text);
}

function htmlToLines(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let result = '';
  function walk(node) {
    if (node.nodeType === 3) { // text node
      result += node.textContent;
    } else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const isBlock = /^(p|div|li|br|h[1-6])$/.test(tag);
      if (isBlock && result && !result.endsWith('\n')) result += '\n';
      node.childNodes.forEach(walk);
      if (isBlock && !result.endsWith('\n')) result += '\n';
    }
  }
  tmp.childNodes.forEach(walk);
  return result.trim();
}

function formatExplanation(text, ans) {
  // Build set of correct letter indices
  const ansArr = Array.isArray(ans) ? ans : (ans !== undefined ? [ans] : []);
  const correctLetters = new Set(ansArr.map(i => String.fromCharCode(97 + i))); // 0→'a', 1→'b'...
  // If saved as Quill HTML — extract plain text preserving line breaks
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = htmlToLines(text);
  }

  // Normalize: insert newline before option markers a) b) c) d) e)
  // Only block when the pattern looks like "(X – Y)" i.e. digit-dash-letter inside parens
  // Strategy: first protect patterns like "(1 – C)" or "(3-B)" with a placeholder,
  // then split on remaining X) patterns, then restore
  const protected_map = {};
  let pid = 0;
  text = text.replace(/\([^)]*[a-e][^)]*\)/gi, m => {
    const key = `__P${pid++}__`;
    protected_map[key] = m;
    return key;
  });
  text = text.replace(/\s+([a-e]\))\s*/gi, (_, letter) => `\n${letter} `);
  Object.entries(protected_map).forEach(([k, v]) => { text = text.replace(k, v); });

  // Split on transition words like "Thus:" "Therefore:" "So:"
  text = text.replace(/\s+(Thus|Therefore|So|Hence|Note):/gi, (_, word) => `\n${word}:`);

  // Split into lines and parse
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const optionRegex = /^([a-e])\)\s*/i;

  const introLines = [];
  const groups = [];
  let inOptions = false;

  for (const line of lines) {
    const m = line.match(/^([a-e])\)\s*(.*)/i);
    if (m) {
      inOptions = true;
      groups.push({ letter: m[1].toLowerCase(), text: m[2] });
    } else if (inOptions && groups.length) {
      groups[groups.length - 1].text += ' ' + line;
    } else {
      introLines.push(line);
    }
  }

  // Fallback: no structured options found
  if (!groups.length) {
    return `<div class="exp-intro">${text}</div>`;
  }

  let html = '';
  if (introLines.length) {
    // Check if any line contains bullet points — render as proper list
    const joined = introLines.join(' ');
    if (joined.includes('•')) {
      // Split on bullet, render as styled list
      const parts = joined.split('•').map(s => s.trim()).filter(Boolean);
      // First part before any bullet is a header
      const hasBulletFirst = joined.trimStart().startsWith('•');
      const header = hasBulletFirst ? '' : parts[0];
      const items  = hasBulletFirst ? parts : parts.slice(1);
      html += `<div class="exp-intro">`;
      if (header) html += `<div style="margin-bottom:0.4rem">${header}</div>`;
      if (items.length) html += `<ul class="exp-bullets">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
      html += `</div>`;
    } else {
      html += `<div class="exp-intro">${introLines.join(' ')}</div>`;
    }
  }

  html += '<div class="exp-options">';
  for (const g of groups) {
    const isCorrect = correctLetters.size > 0
      ? correctLetters.has(g.letter.toLowerCase())
      : /^is correct/i.test(g.text.trim()); // fallback if no ans passed
    html += buildExpRow(g.letter, g.text.trim(), isCorrect);
  }
  html += '</div>';

  return html;
}

function buildExpRow(letter, body, isCorrect) {
  // Separate "IS CORRECT" / "is correct" tag from the rest of the body
  const tagMatch = body.match(/^(.*?)\s*\bis correct\b\.?\s*(.*)/i);
  let displayBody = body;
  if (tagMatch) {
    const before = tagMatch[1].trim();
    const after  = tagMatch[2].trim();
    const combined = [before, after].filter(Boolean).join(' — ');
    // If nothing left after stripping "is correct", show the original body
    displayBody = combined || body;
  }
  return `
    <div class="exp-row ${isCorrect ? 'exp-row-correct' : ''}">
      <span class="exp-letter">${letter.toUpperCase()}</span>
      <span class="exp-body">${displayBody}</span>
      ${isCorrect ? '<span class="exp-tag">✓ נכון</span>' : ''}
    </div>`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updateAnsweredStats() {
  const answeredEl = document.getElementById('stat-answered');
  const uniqueEl   = document.getElementById('stat-unique');
  if (answeredEl) answeredEl.textContent = ANSWERED_IDS.length;
  if (uniqueEl)   uniqueEl.textContent   = UNIQUE_IDS.length;
}

function updateWrongCount() {
  const _he = CURRENT_LANG === 'he';
  const el = document.getElementById('count-wrong');
  if (el) el.textContent = WRONG_IDS.length + (_he ? ' שגיאות' : ' mistakes');
  const navEl = document.getElementById('nav-count-wrong');
  if (navEl) navEl.textContent = WRONG_IDS.length;
}

function updateStarredCount() {
  const combinedCount = new Set([...STARRED_IDS, ...Object.keys(NOTES).map(Number).filter(n => !isNaN(n))]).size;
  const he = CURRENT_LANG === 'he';
  const el = document.getElementById('count-starred');
  if (el) el.textContent = combinedCount + (he ? ' מסומנות' : ' starred');
  const navEl = document.getElementById('nav-count-starred');
  if (navEl) navEl.textContent = combinedCount;
}

async function toggleStar() {
  const q = SESSION.questions[SESSION.idx];
  const gIdx = ACTIVE_Q.indexOf(q);
  if (gIdx < 0) return;
  const already = STARRED_IDS.indexOf(gIdx);
  if (already >= 0) {
    STARRED_IDS.splice(already, 1);
  } else {
    STARRED_IDS.push(gIdx);
  }
  console.log('[STAR] STARRED_IDS after toggle:', JSON.stringify(STARRED_IDS));
  console.log('[STAR] _fbSaveUserData ready?', !!window._fbSaveUserData);
  console.log('[STAR] user logged in?', !!window._currentUser);
  const isStarred = STARRED_IDS.includes(gIdx);
  const starBtn = document.getElementById('btn-star');
  starBtn.textContent = isStarred ? '⭐' : '☆';
  starBtn.style.color = isStarred ? '#ffd166' : 'var(--muted)';
  // Animate
  starBtn.style.transform = 'scale(1.4)';
  setTimeout(() => starBtn.style.transform = 'scale(1)', 200);
  updateStarredCount();
  await persistData();
}

async function saveNote() {
  const q = SESSION.questions[SESSION.idx];
  if (!q) return;
  const gIdx = ACTIVE_Q.indexOf(q);
  if (gIdx < 0) return;
  const val = document.getElementById('note-input').value.trim();
  if (val) NOTES[String(gIdx)] = val;
  else delete NOTES[String(gIdx)];
  await persistData();
}

// ── Speed Mode Timer ──
async function startSpeedTimer() {
  clearSpeedTimer();
  const fill = document.getElementById('speed-timer-fill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '100%'; }
  // Trigger reflow then animate
  setTimeout(() => {
    if (fill) { fill.style.transition = `width ${SPEED_SECONDS}s linear`; fill.style.width = '0%'; }
  }, 50);
  SPEED_TIMER = setTimeout(() => {
    // Time's up — count as wrong, move on
    const opts = document.querySelectorAll('.option');
    if (opts.length && !opts[0].classList.contains('disabled')) {
      const q = SESSION.questions[SESSION.idx];
      opts.forEach(o => o.classList.add('disabled'));
      opts[q.ans].classList.add('correct');
      SESSION.wrong++;
      SESSION.answers[SESSION.idx] = { q, chosen: -1, correct: false, timeout: true };
      const gIdx = ACTIVE_Q.indexOf(q);
      if (gIdx >= 0) {
        ANSWERED_IDS.push(gIdx);
        if (!UNIQUE_IDS.includes(gIdx)) UNIQUE_IDS.push(gIdx);
        if (!WRONG_IDS.includes(gIdx)) WRONG_IDS.push(gIdx);
      }
      document.getElementById('score-live').textContent = `✓ ${SESSION.correct} · ✗ ${SESSION.wrong}`;
      document.getElementById('btn-skip').classList.add('hidden');
      document.getElementById('btn-next').classList.remove('hidden');
      document.getElementById('note-area').classList.remove('hidden');
      persistData().catch(console.error);
      updateAnsweredStats();
      // Auto-advance after 1.5s
      setTimeout(() => advanceOrFinish(), 1500);
    }
  }, SPEED_SECONDS * 1000);
}

function clearSpeedTimer() {
  if (SPEED_TIMER) { clearTimeout(SPEED_TIMER); SPEED_TIMER = null; }
  const fill = document.getElementById('speed-timer-fill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '100%'; }
}

// ── Exam Mode Countdown Timer (60 min) ──
let EXAM_TIMER_INTERVAL = null;
let EXAM_TIMER_SECONDS  = 0;
let EXAM_START_TIME     = null;

function startExamTimer() {
  clearExamTimer();
  EXAM_TIMER_SECONDS = 60 * 60;
  EXAM_START_TIME    = Date.now();
  const display = document.getElementById('exam-timer-display');
  const fill    = document.getElementById('exam-timer-fill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = '100%'; }

  function tick() {
    EXAM_TIMER_SECONDS--;
    if (display) {
      const m = Math.floor(EXAM_TIMER_SECONDS / 60);
      const s = EXAM_TIMER_SECONDS % 60;
      display.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
      if (EXAM_TIMER_SECONDS <= 300) {
        display.style.color = 'var(--error)';
        if (fill) fill.style.background = 'var(--error)';
      } else if (EXAM_TIMER_SECONDS <= 600) {
        display.style.color = 'var(--warning)';
        if (fill) fill.style.background = 'var(--warning)';
      }
    }
    if (fill) {
      fill.style.transition = 'width 1s linear';
      fill.style.width = (EXAM_TIMER_SECONDS / 3600 * 100) + '%';
    }
    if (EXAM_TIMER_SECONDS <= 0) {
      clearExamTimer();
      const he = CURRENT_LANG === 'he';
      alert(he ? '\u23F0 \u05d4\u05d6\u05de\u05df \u05e0\u05d2\u05de\u05e8! 60 \u05d3\u05e7\u05d5\u05ea \u05d7\u05dc\u05e4\u05d5.' : "\u23F0 Time's up! 60 minutes have elapsed.");
      showResults();
    }
  }
  EXAM_TIMER_INTERVAL = setInterval(tick, 1000);
}

function clearExamTimer() {
  if (EXAM_TIMER_INTERVAL) { clearInterval(EXAM_TIMER_INTERVAL); EXAM_TIMER_INTERVAL = null; }
  const display = document.getElementById('exam-timer-display');
  const fill    = document.getElementById('exam-timer-fill');
  if (display) { display.textContent = '60:00'; display.style.color = 'var(--accent)'; }
  if (fill)    { fill.style.transition = 'none'; fill.style.width = '100%'; fill.style.background = 'linear-gradient(90deg,var(--accent),#9c94ff)'; }
}

function updateSavedPage() {
  const he = CURRENT_LANG === 'he';
  const letters = he ? ['א','ב','ג','ד','ה','ו'] : ['A','B','C','D','E','F'];

  // Build combined index list: starred + notes
  const notedIdxs = Object.keys(NOTES).map(Number).filter(n => !isNaN(n));
  const combinedIdxs = [...new Set([...STARRED_IDS, ...notedIdxs])].sort((a,b) => a - b);

  const list = document.getElementById('saved-list');
  const empty = document.getElementById('saved-empty');
  if (!list) return;

  if (combinedIdxs.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = '';
  combinedIdxs.forEach(idx => {
    const q = ACTIVE_Q[idx];
    if (!q) return;
    const isStarred = STARRED_IDS.includes(idx);
    const noteVal   = NOTES[String(idx)] || '';
    const ansLetter = letters[q.ans] || '?';
    const ansText   = q.opts[q.ans] || '';

    const div = document.createElement('div');
    div.className = 'saved-item';
    div.innerHTML = `
      <div class="saved-item-header">
        <div class="saved-item-q" onclick="openQModal(${idx})" style="cursor:pointer" title="לחץ לתצוגה מלאה">${q.q}</div>
        <div class="saved-item-actions">
          ${isStarred ? `<button class="btn-unstar" title="הסר כוכב" onclick="removeStar(${idx}, this)">⭐</button>` : `<span style="color:var(--muted);font-size:0.9rem;padding:0.2rem">☆</span>`}
          <button title="הסר מהרשימה" onclick="removeFromSaved(${idx}, this.closest('.saved-item'))" style="font-size:0.85rem">✕</button>
        </div>
      </div>
      <div class="saved-item-meta">
        <span class="tag tag-src" style="font-size:0.6rem">${q.src}</span>
        ${q.lo ? `<span class="tag tag-lo" style="font-size:0.6rem">${q.lo}</span>` : ''}
        ${(q.k_level||q.k) ? `<span class="tag tag-k" style="font-size:0.6rem">${q.k_level||q.k}</span>` : ''}
      </div>
      <div class="saved-item-answer">✓ ${he ? 'תשובה נכונה' : 'Answer'}: ${ansLetter}) ${ansText}</div>
      <div class="saved-item-note">
        <div class="saved-item-note-label">📝 ${he ? 'הערה' : 'Note'}</div>
        <textarea placeholder="${he ? 'הוסף הערה...' : 'Add a note...'}" data-idx="${idx}" onblur="saveNoteFromPage(this)">${noteVal}</textarea>
      </div>
    `;
    list.appendChild(div);
  });

  // Update subtitle
  const sub = document.getElementById('saved-page-sub');
  if (sub) sub.textContent = `${combinedIdxs.length} ${he ? 'שאלות' : 'questions'}`;
}

async function saveNoteFromPage(textarea) {
  const idx = String(textarea.dataset.idx);
  const val = textarea.value.trim();
  if (val) NOTES[idx] = val;
  else delete NOTES[idx];
  updateStarredCount();
  await persistData();
  // If removed note and not starred, remove item from UI
  if (!val && !STARRED_IDS.includes(Number(idx))) {
    const item = textarea.closest('.saved-item');
    if (item) item.style.transition = 'opacity 0.3s';
    if (item) { item.style.opacity = '0'; setTimeout(() => updateSavedPage(), 320); }
  }
}

async function removeStar(idx, btn) {
  const pos = STARRED_IDS.indexOf(idx);
  if (pos >= 0) STARRED_IDS.splice(pos, 1);
  updateStarredCount();
  await persistData();
  // If no note either, remove from list; otherwise just update star icon
  if (!NOTES[String(idx)]) {
    const item = btn.closest('.saved-item');
    if (item) { item.style.transition = 'opacity 0.3s'; item.style.opacity = '0'; setTimeout(() => updateSavedPage(), 320); }
  } else {
    updateSavedPage();
  }
}

async function removeFromSaved(idx, itemEl) {
  // Remove star
  const pos = STARRED_IDS.indexOf(idx);
  if (pos >= 0) STARRED_IDS.splice(pos, 1);
  // Remove note
  delete NOTES[String(idx)];
  updateStarredCount();
  await persistData();
  if (itemEl) { itemEl.style.transition = 'opacity 0.3s'; itemEl.style.opacity = '0'; setTimeout(() => updateSavedPage(), 320); }
}

async function clearSaved() {
  const he = CURRENT_LANG === 'he';
  if (!confirm(he ? 'למחוק את כל השאלות המסומנות וההערות?' : 'Clear all starred questions and notes?')) return;
  STARRED_IDS = [];
  NOTES = {};
  updateStarredCount();
  await persistData();
  updateSavedPage();
}

// ── FLASHCARDS ──────────────────────────────────────────────────────────────

function initFlashcards() {
  FC_POOL = [...ALL_GLOSSARY];
  FCO_IDX = 0;
  // Sync button states with defaults
  const vGrid = document.getElementById('fc-view-grid');
  const vOne  = document.getElementById('fc-view-one');
  if (vGrid) vGrid.classList.toggle('active', FC_VIEW === 'grid');
  if (vOne)  vOne.classList.toggle('active',  FC_VIEW === 'one');
  const dTerm = document.getElementById('fc-dir-term');
  const dDef  = document.getElementById('fc-dir-def');
  if (dTerm) dTerm.classList.toggle('active', FC_DIRECTION === 'term');
  if (dDef)  dDef.classList.toggle('active',  FC_DIRECTION === 'def');
  renderFlashcards();
}

function fcSetView(v) {
  FC_VIEW = v;
  document.getElementById('fc-view-grid').classList.toggle('active', v === 'grid');
  document.getElementById('fc-view-one').classList.toggle('active',  v === 'one');
  renderFlashcards();
}

function fcSetDirection(d) {
  FC_DIRECTION = d;
  document.getElementById('fc-dir-term').classList.toggle('active', d === 'term');
  document.getElementById('fc-dir-def').classList.toggle('active',  d === 'def');
  FCO_IDX = 0;
  renderFlashcards();
}

function renderFlashcards() {
  const gridEl = document.getElementById('fc-grid');
  const oneEl  = document.getElementById('fc-one');
  const empty  = document.getElementById('fc-empty');
  const sub    = document.getElementById('fc-sub');
  if (!gridEl) return;

  if (FC_POOL.length === 0) {
    gridEl.classList.add('hidden');
    oneEl.classList.add('hidden');
    empty.classList.remove('hidden');
    if (sub) sub.textContent = 'לא נמצאו תוצאות';
    updateFcProgress();
    return;
  }
  empty.classList.add('hidden');
  if (sub) sub.textContent = `${FC_POOL.length} מושגים`;

  if (FC_VIEW === 'grid') {
    oneEl.classList.add('hidden');
    gridEl.classList.remove('hidden');
    renderGrid();
  } else {
    gridEl.classList.add('hidden');
    oneEl.classList.remove('hidden');
    renderOne(null); // null = no entry animation
  }
  updateFcProgress();
}

// ── GRID ──────────────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById('fc-grid');
  grid.innerHTML = '';
  const termFirst = FC_DIRECTION === 'term';
  FC_POOL.forEach(item => {
    const isKnown = FC_KNOWN.has(item.id);
    const frontHtml = termFirst
      ? `<div class="fc-term">${item.term}</div><div class="fc-hint">הפוך ▾</div>`
      : `<div class="fc-term" style="font-size:0.76rem;font-weight:400;line-height:1.6;text-align:right;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">${item.definition}</div><div class="fc-hint">הפוך ▾</div>`;
    const backHtml = termFirst
      ? `<div class="fc-back-label">הגדרה</div><div class="fc-definition">${item.definition}</div>`
      : `<div class="fc-back-label">מושג</div><div class="fc-term" style="text-align:center;margin:auto">${item.term}</div>`;
    const card = document.createElement('div');
    card.className = 'fc-card' + (isKnown ? ' known' : '');
    card.dataset.id = item.id;
    card.innerHTML = `
      <div class="fc-card-inner">
        <div class="fc-front">${frontHtml}</div>
        <div class="fc-back">
          ${backHtml}
          <div class="fc-card-footer">
            <span class="fc-id">#${item.id}</span>
            <button class="fc-known-btn" onclick="toggleKnown(event,${item.id},this.closest('.fc-card'))">${isKnown?'✓ ידוע':'+ ידוע'}</button>
          </div>
        </div>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.classList.contains('fc-known-btn')) return;
      SFX.flipCard();
      card.classList.toggle('flipped');
    });
    grid.appendChild(card);
  });
}

// ── ONE-AT-A-TIME ─────────────────────────────────────────────────────────

function renderOne(entryDir) {
  // entryDir: 'right' = coming from prev, 'left' = coming from next, null = instant
  if (FC_POOL.length === 0) return;
  if (FCO_IDX >= FC_POOL.length) FCO_IDX = FC_POOL.length - 1;
  if (FCO_IDX < 0) FCO_IDX = 0;

  const item      = FC_POOL[FCO_IDX];
  const termFirst = FC_DIRECTION === 'term';
  const isKnown   = FC_KNOWN.has(item.id);

  document.getElementById('fco-idx').textContent   = FCO_IDX + 1;
  document.getElementById('fco-total').textContent = FC_POOL.length;

  // Fill content
  if (termFirst) {
    document.getElementById('fco-front-label').textContent = 'מושג';
    document.getElementById('fco-front-content').textContent = item.term;
    document.getElementById('fco-front-content').style.cssText = 'font-size:1.25rem';
    document.getElementById('fco-back-label').textContent = 'הגדרה';
    document.getElementById('fco-back-content').textContent = item.definition;
    document.getElementById('fco-back-content').style.cssText = 'font-size:0.9rem';
  } else {
    document.getElementById('fco-front-label').textContent = 'הגדרה';
    document.getElementById('fco-front-content').textContent = item.definition;
    document.getElementById('fco-front-content').style.cssText = 'font-size:0.9rem';
    document.getElementById('fco-back-label').textContent = 'מושג';
    document.getElementById('fco-back-content').textContent = item.term;
    document.getElementById('fco-back-content').style.cssText = 'font-size:1.25rem';
  }

  const cardEl   = document.getElementById('fco-card');
  const knownBtn = document.getElementById('fco-known-btn');

  // Reset card state
  cardEl.className = 'fco-card' + (isKnown ? ' is-known' : '');
  cardEl.style.cssText = '';

  // Known button
  if (knownBtn) {
    knownBtn.textContent = isKnown ? '✓ ידוע' : '⭐ ידוע';
    knownBtn.classList.toggle('is-known', isKnown);
  }

  // Entry animation
  if (entryDir === 'right') {
    cardEl.classList.add('swipe-in-right');
    cardEl.addEventListener('animationend', () => cardEl.classList.remove('swipe-in-right'), { once: true });
  } else if (entryDir === 'left') {
    cardEl.classList.add('swipe-in-left');
    cardEl.addEventListener('animationend', () => cardEl.classList.remove('swipe-in-left'), { once: true });
  }

  // Tap to flip
  const stage = document.getElementById('fco-stage');
  stage.onclick = () => { SFX.flipCard(); cardEl.classList.toggle('flipped'); };

  // Touch/swipe support
  fcInitSwipe(stage);
}

// Navigate without marking known/unknown
function fcoGo(delta) {
  const cardEl = document.getElementById('fco-card');
  cardEl.classList.add('swipe-right');
  setTimeout(() => {
    FCO_IDX = Math.max(0, Math.min(FC_POOL.length - 1, FCO_IDX + delta));
    renderOne('left');
  }, 280);
}

// Mark current card as known / not known (toggle)
function fcoMarkKnown() {
  const item = FC_POOL[FCO_IDX];
  if (!item) return;
  if (FC_KNOWN.has(item.id)) {
    FC_KNOWN.delete(item.id);
  } else {
    FC_KNOWN.add(item.id);
    SFX.markKnown();
  }
  updateFcProgress();
  // Update card + button state without navigating
  const cardEl   = document.getElementById('fco-card');
  const knownBtn = document.getElementById('fco-known-btn');
  const nowKnown = FC_KNOWN.has(item.id);
  cardEl.classList.toggle('is-known', nowKnown);
  if (knownBtn) {
    knownBtn.textContent = nowKnown ? '✓ ידוע' : '⭐ ידוע';
    knownBtn.classList.toggle('is-known', nowKnown);
  }
}

// Touch swipe
let _swipeX = null;
function fcInitSwipe(el) {
  el.ontouchstart = e => { _swipeX = e.touches[0].clientX; };
  el.ontouchend   = e => {
    if (_swipeX === null) return;
    const dx = e.changedTouches[0].clientX - _swipeX;
    _swipeX = null;
    if (Math.abs(dx) < 40) return;
    // RTL: swipe right (dx>0) = go NEXT (←), swipe left (dx<0) = go PREV (→)
    if (dx > 0) fcoGo(1); else fcoGo(-1);
  };
}

function toggleKnown(e, id, cardEl) {
  e.stopPropagation();
  if (FC_KNOWN.has(id)) {
    FC_KNOWN.delete(id);
    cardEl.classList.remove('known', 'flipped');
    cardEl.querySelector('.fc-known-btn').textContent = '+ ידוע';
  } else {
    FC_KNOWN.add(id);
    cardEl.classList.add('known');
    cardEl.querySelector('.fc-known-btn').textContent = '✓ ידוע';
  }
  updateFcProgress();
}

function updateFcProgress() {
  const total   = ALL_GLOSSARY.length;
  const known   = FC_KNOWN.size;
  const pct     = total ? Math.round(known / total * 100) : 0;
  const knownEl = document.getElementById('fc-known-count');
  const fillEl  = document.getElementById('fc-prog-fill');
  const totEl   = document.getElementById('fc-total-count');
  if (knownEl) knownEl.textContent = `${known} ידועים`;
  if (fillEl)  fillEl.style.width  = pct + '%';
  if (totEl)   totEl.textContent   = `${FC_POOL.length} / ${total}`;
}

function fcFilter() {
  const q = (document.getElementById('fc-search')?.value || '').trim().toLowerCase();
  FC_POOL = q
    ? ALL_GLOSSARY.filter(x => x.term.toLowerCase().includes(q) || x.definition.includes(q))
    : [...ALL_GLOSSARY];
  FCO_IDX = 0;
  renderFlashcards();
}

function fcShuffle() {
  const q = (document.getElementById('fc-search')?.value || '').trim().toLowerCase();
  const base = q
    ? ALL_GLOSSARY.filter(x => x.term.toLowerCase().includes(q) || x.definition.includes(q))
    : [...ALL_GLOSSARY];
  FC_POOL = shuffle(base);
  FCO_IDX = 0;
  renderFlashcards();
}

function fcFilterUnknown() {
  FC_POOL = ALL_GLOSSARY.filter(x => !FC_KNOWN.has(x.id));
  FCO_IDX = 0;
  document.getElementById('fc-btn-unknown').style.display = 'none';
  document.getElementById('fc-btn-all').style.display     = 'flex';
  renderFlashcards();
}

function fcShowAll() {
  FC_POOL = [...ALL_GLOSSARY];
  FCO_IDX = 0;
  document.getElementById('fc-btn-all').style.display     = 'none';
  document.getElementById('fc-btn-unknown').style.display = 'flex';
  const s = document.getElementById('fc-search');
  if (s) s.value = '';
  renderFlashcards();
}

// ── END FLASHCARDS ───────────────────────────────────────────────────────────


// ── Question Preview Modal ──
function openQModal(idx) {
  const q = ACTIVE_Q[idx];
  if (!q) return;
  const he = CURRENT_LANG === 'he';
  const letters = he ? ['א','ב','ג','ד','ה','ו'] : ['A','B','C','D','E','F'];

  // Meta tags
  const metaEl = document.getElementById('qm-meta');
  metaEl.innerHTML = `
    ${q.src  ? `<span class="tag tag-src">${q.src}</span>` : ''}
    ${(q.k_level||q.k) ? `<span class="tag tag-k">${q.k_level||q.k}</span>` : ''}
    ${q.lo   ? `<span class="tag tag-lo">${q.lo}</span>` : ''}
  `;

  // Question text (use formatQuestion for proper rendering)
  document.getElementById('qm-text').innerHTML = formatQuestion(q.q);

  // Options
  const optsEl = document.getElementById('qm-options');
  optsEl.innerHTML = q.opts.map((opt, i) => `
    <div class="q-modal-option ${i === q.ans ? 'correct' : ''}">
      <span class="opt-letter">${letters[i]}</span>
      <span class="opt-text">${opt}</span>
    </div>
  `).join('');

  // Explanation
  const expEl = document.getElementById('qm-exp');
  if (q.exp) {
    expEl.classList.remove('hidden');
    expEl.innerHTML = `<strong>${he ? 'הסבר' : 'Explanation'}</strong>${q.exp}`;
  } else {
    expEl.classList.add('hidden');
  }

  document.getElementById('q-preview-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeQModal(e) {
  if (e && e.target !== document.getElementById('q-preview-modal')) return;
  document.getElementById('q-preview-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQModal();
});


// ── DEBUG PANEL (remove after fixing sync) ──
(function() {
  const logs = [];
  const _origLog  = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origErr  = console.error.bind(console);
  function capture(level, args) {
    const msg = args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch(e) { return String(a); }
    }).join(' ');
    logs.push('[' + level + '] ' + msg);
    if (logs.length > 60) logs.shift();
    const el = document.getElementById('_dbg_content');
    if (el) el.textContent = logs.join('\n');
  }
  console.log   = (...a) => { _origLog(...a);  capture('LOG',  a); };
  console.warn  = (...a) => { _origWarn(...a); capture('WARN', a); };
  console.error = (...a) => { _origErr(...a);  capture('ERR',  a); };

  // Only show debug panel for the admin user
  function _maybeShowDebug() {
    if (window._currentUser?.email !== 'tomer9tomer@gmail.com') return;
    const panel = document.createElement('div');
    panel.id = '_dbg_panel';
    panel.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;height:50vh;background:#111;color:#0f0;font-size:11px;font-family:monospace;z-index:99999;overflow-y:auto;padding:8px;white-space:pre-wrap;word-break:break-all';
    panel.innerHTML = '<div id="_dbg_content"></div>';
    document.body.appendChild(panel);

    const btn = document.createElement('button');
    btn.textContent = '🐛';
    btn.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:99999;background:#333;color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;opacity:0.7';
    btn.onclick = () => {
      const p = document.getElementById('_dbg_panel');
      p.style.display = p.style.display === 'none' ? 'block' : 'none';
      const el = document.getElementById('_dbg_content');
      if (el) el.textContent = logs.join('\n');
      setTimeout(() => { p.scrollTop = p.scrollHeight; }, 50);
    };
    document.body.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Poll until auth resolves, then show debug if eligible
    const interval = setInterval(() => {
      if (window._currentUser !== undefined) {
        clearInterval(interval);
        _maybeShowDebug();
      }
    }, 300);
    // Fallback: also trigger when auth state changes
    const _origInit = window.init;
    window.init = function(...args) {
      _maybeShowDebug();
      return _origInit?.apply(this, args);
    };
  });
})();

loadQuestions(); // loads questions.json; init() fires only after auth resolves

// ═══════════════════════════════════════════════════════════════
// GLOSSARY QUIZ GAME
// ═══════════════════════════════════════════════════════════════

let GG_POOL = [];       // shuffled questions for this session
let GG_IDX  = 0;        // current question index
let GG_CORRECT = 0;     // correct answers
let GG_ANSWERED = false;// has the user answered the current q

function startGlossaryGame() {
  if (!ALL_GLOSSARY || ALL_GLOSSARY.length < 4) {
    alert('המילון לא נטען עדיין. נסה שוב.');
    return;
  }
  // Build pool: 20 questions, alternating term→def and def→term randomly
  const pool = shuffle([...ALL_GLOSSARY]).slice(0, 20);
  GG_POOL = pool.map(item => {
    const mode = Math.random() < 0.5 ? 'term2def' : 'def2term';
    return { item, mode };
  });
  GG_IDX = 0;
  GG_CORRECT = 0;
  GG_ANSWERED = false;

  // Show page
  document.getElementById('gg-end').classList.add('hidden');
  document.getElementById('gg-question-card').classList.remove('hidden');
  document.getElementById('gg-options').classList.remove('hidden');
  navTo('glossary-game-page');
  ggRenderQuestion();
}

function endGlossaryGame() {
  navTo('flashcards-page');
}

function ggRenderQuestion() {
  if (GG_IDX >= GG_POOL.length) {
    ggShowEnd();
    return;
  }
  GG_ANSWERED = false;
  const { item, mode } = GG_POOL[GG_IDX];
  const total = GG_POOL.length;

  // Progress
  document.getElementById('gg-progress-text').textContent = `${GG_IDX + 1} / ${total}`;
  document.getElementById('gg-progress-fill').style.width = ((GG_IDX / total) * 100) + '%';
  document.getElementById('gg-score-text').textContent = `✓ ${GG_CORRECT}`;
  document.getElementById('gg-feedback').classList.add('hidden');
  document.getElementById('gg-next-btn').classList.add('hidden');

  // Question text
  const typeLabel = document.getElementById('gg-question-type-label');
  const questionText = document.getElementById('gg-question-text');
  if (mode === 'term2def') {
    typeLabel.textContent = 'מה ההגדרה של המושג?';
    questionText.textContent = item.term;
    questionText.style.fontSize = '1.15rem';
  } else {
    typeLabel.textContent = 'לאיזה מושג מתאימה ההגדרה?';
    questionText.textContent = item.definition;
    questionText.style.fontSize = '0.88rem';
  }

  // Pick 3 distractors
  const distractors = shuffle(ALL_GLOSSARY.filter(x => x.id !== item.id)).slice(0, 3);
  const options = shuffle([item, ...distractors]);

  // Render options
  const optEl = document.getElementById('gg-options');
  optEl.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'gg-option-btn';
    btn.textContent = mode === 'term2def' ? opt.definition : opt.term;
    btn.dataset.id = opt.id;
    btn.addEventListener('click', () => ggAnswer(opt.id === item.id, btn));
    optEl.appendChild(btn);
  });
}

function ggAnswer(isCorrect, btn) {
  if (GG_ANSWERED) return;
  GG_ANSWERED = true;
  if (isCorrect) {
    GG_CORRECT++;
    SFX.correct();
  } else {
    SFX.wrong();
  }

  // Style all buttons
  const optEl = document.getElementById('gg-options');
  const { item } = GG_POOL[GG_IDX];
  const mode = GG_POOL[GG_IDX].mode;
  optEl.querySelectorAll('.gg-option-btn').forEach(b => {
    const bid = parseInt(b.dataset.id);
    if (bid === item.id) {
      b.classList.add('gg-correct');
    } else if (b === btn && !isCorrect) {
      b.classList.add('gg-wrong');
    }
    b.disabled = true;
  });

  // Feedback
  const fb = document.getElementById('gg-feedback');
  fb.classList.remove('hidden');
  if (isCorrect) {
    fb.textContent = '✓ נכון!';
    fb.style.cssText = 'background:rgba(67,233,123,0.12);color:var(--success);text-align:center;padding:0.7rem;border-radius:12px;margin-bottom:0.8rem;font-size:0.9rem;border:1px solid rgba(67,233,123,0.3)';
  } else {
    const correctOpt = mode === 'term2def' ? item.definition : item.term;
    fb.innerHTML = `✗ לא נכון. <span style="color:var(--success)">התשובה הנכונה:</span> ${correctOpt}`;
    fb.style.cssText = 'background:rgba(255,101,132,0.1);color:var(--error);text-align:center;padding:0.7rem;border-radius:12px;margin-bottom:0.8rem;font-size:0.88rem;border:1px solid rgba(255,101,132,0.3)';
  }
  document.getElementById('gg-next-btn').classList.remove('hidden');
}

function ggNextQuestion() {
  GG_IDX++;
  ggRenderQuestion();
}

function ggShowEnd() {
  document.getElementById('gg-question-card').classList.add('hidden');
  document.getElementById('gg-options').classList.add('hidden');
  document.getElementById('gg-feedback').classList.add('hidden');
  document.getElementById('gg-next-btn').classList.add('hidden');
  document.getElementById('gg-end').classList.remove('hidden');

  const total = GG_POOL.length;
  const pct = Math.round((GG_CORRECT / total) * 100);
  document.getElementById('gg-end-score').textContent = `${GG_CORRECT} / ${total} נכונות (${pct}%)`;
  let msg = '';
  if (pct >= 90) msg = '🔥 מושלם! שלטת במיליון מושגים!';
  else if (pct >= 70) msg = '👍 כל הכבוד! תוצאה טובה מאוד.';
  else if (pct >= 50) msg = '📚 סביר — כדאי לחזור על הכרטיסיות.';
  else msg = '💪 יש מקום לשיפור. תמשיך לתרגל!';
  document.getElementById('gg-end-msg').textContent = msg;
}


// ═══════════════════════════════════════════════════════════════
// MATCH GAME
// ═══════════════════════════════════════════════════════════════

let MG_PAIRS = [];          // current 5 pairs [{id, term, definition}]
let MG_SELECTED = null;     // {type:'term'|'def', id, el}
let MG_MATCHED = new Set(); // matched ids
let MG_ERRORS = 0;
let MG_TOTAL_MATCHED = 0;
let MG_TOTAL_ROUNDS = 0;
let MG_TIMER_START = 0;
let MG_TIMER_INT = null;
let MG_TOTAL_SETS = 0;

const MG_SET_SIZE = 5;

function startMatchGame() {
  if (!ALL_GLOSSARY || ALL_GLOSSARY.length < MG_SET_SIZE) {
    alert('המילון לא נטען עדיין.');
    return;
  }
  MG_TOTAL_MATCHED = 0;
  MG_TOTAL_ROUNDS = 0;
  MG_ERRORS = 0;
  MG_TOTAL_SETS = Math.floor(ALL_GLOSSARY.length / MG_SET_SIZE); // how many sets available
  MG_REMAINING_POOL = shuffle([...ALL_GLOSSARY]);

  document.getElementById('mg-end').classList.add('hidden');
  document.getElementById('mg-board').classList.remove('hidden');
  navTo('match-game-page');
  mgNextRound();
}

function endMatchGame() {
  clearInterval(MG_TIMER_INT);
  navTo('home');
}

function mgNextRound() {
  MG_MATCHED = new Set();
  MG_SELECTED = null;
  MG_TOTAL_ROUNDS++;

  // Take next 5 items
  if (!MG_REMAINING_POOL || MG_REMAINING_POOL.length < MG_SET_SIZE) {
    MG_REMAINING_POOL = shuffle([...ALL_GLOSSARY]);
  }
  MG_PAIRS = MG_REMAINING_POOL.splice(0, MG_SET_SIZE);

  // Update header
  document.getElementById('mg-round-text').textContent = `סט ${MG_TOTAL_ROUNDS}`;
  document.getElementById('mg-score-text').textContent = `✓ ${MG_TOTAL_MATCHED} זוגות`;
  document.getElementById('mg-progress-fill').style.width = '0%';
  document.getElementById('mg-feedback').classList.add('hidden');

  // Start timer
  clearInterval(MG_TIMER_INT);
  MG_TIMER_START = Date.now();
  MG_TIMER_INT = setInterval(() => {
    const elapsed = Math.floor((Date.now() - MG_TIMER_START) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const el = document.getElementById('mg-timer');
    if (el) el.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;
  }, 500);

  mgRenderBoard();
}

function mgRenderBoard() {
  const board = document.getElementById('mg-board');
  board.innerHTML = '';

  const terms = shuffle([...MG_PAIRS]);

  // Ensure defs order never matches terms order (no same-row pair)
  let defs;
  let attempts = 0;
  do {
    defs = shuffle([...MG_PAIRS]);
    attempts++;
  } while (attempts < 20 && defs.some((d, i) => d.id === terms[i].id));

  // Render as rows: each row has one term tile and one def tile
  terms.forEach((p, i) => {
    const termBtn = document.createElement('button');
    termBtn.className = 'mg-tile mg-term';
    termBtn.dataset.id   = p.id;
    termBtn.dataset.type = 'term';
    termBtn.textContent  = p.term;
    termBtn.addEventListener('click', () => mgSelect(termBtn));
    board.appendChild(termBtn);

    const defBtn = document.createElement('button');
    defBtn.className = 'mg-tile mg-def';
    defBtn.dataset.id   = defs[i].id;
    defBtn.dataset.type = 'def';
    defBtn.textContent  = defs[i].definition;
    defBtn.addEventListener('click', () => mgSelect(defBtn));
    board.appendChild(defBtn);
  });
}

function mgSelect(el) {
  if (el.classList.contains('mg-matched') || el.classList.contains('mg-wrong')) return;

  const type = el.dataset.type;
  const id   = parseInt(el.dataset.id);

  if (!MG_SELECTED) {
    // First selection
    MG_SELECTED = { type, id, el };
    el.classList.add('mg-active');
    return;
  }

  if (MG_SELECTED.el === el) {
    // Deselect same
    el.classList.remove('mg-active');
    MG_SELECTED = null;
    return;
  }

  if (MG_SELECTED.type === type) {
    // Same column — switch selection
    MG_SELECTED.el.classList.remove('mg-active');
    MG_SELECTED = { type, id, el };
    el.classList.add('mg-active');
    return;
  }

  // Check match
  MG_SELECTED.el.classList.remove('mg-active');
  const prevEl = MG_SELECTED.el;
  const prevId = MG_SELECTED.id;
  MG_SELECTED = null;

  if (prevId === id) {
    // ✓ Match!
    prevEl.classList.add('mg-matched');
    el.classList.add('mg-matched');
    MG_MATCHED.add(id);
    MG_TOTAL_MATCHED++;
    SFX.match();
    document.getElementById('mg-score-text').textContent = `✓ ${MG_TOTAL_MATCHED} זוגות`;
    document.getElementById('mg-progress-fill').style.width = ((MG_MATCHED.size / MG_SET_SIZE) * 100) + '%';

    // Flash green
    [prevEl, el].forEach(b => {
      b.classList.add('mg-flash-correct');
      setTimeout(() => b.classList.remove('mg-flash-correct'), 500);
    });

    // Round complete?
    if (MG_MATCHED.size === MG_SET_SIZE) {
      setTimeout(mgRoundComplete, 600);
    }
  } else {
    // ✗ Wrong
    MG_ERRORS++;
    SFX.matchWrong();
    [prevEl, el].forEach(b => {
      b.classList.add('mg-wrong');
      setTimeout(() => b.classList.remove('mg-wrong'), 800);
    });
  }
}

function mgRoundComplete() {
  clearInterval(MG_TIMER_INT);
  SFX.roundComplete();
  const elapsed = Math.floor((Date.now() - MG_TIMER_START) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;

  const fb = document.getElementById('mg-feedback');
  fb.classList.remove('hidden');
  fb.textContent = `✓ הושלם ב-${m}:${String(s).padStart(2,'0')} עם ${MG_ERRORS} שגיאות בסט זה`;
  fb.style.cssText = 'text-align:center;padding:0.6rem;border-radius:10px;margin-bottom:0.8rem;font-size:0.88rem;background:rgba(67,233,123,0.12);color:var(--success);border:1px solid rgba(67,233,123,0.3)';

  MG_ERRORS = 0; // reset per-round errors

  setTimeout(() => {
    mgNextRound();
  }, 1800);
}

let MG_REMAINING_POOL = [];


// ═══════════════════════════════════════════════════════════════
// STREAK MODE
// ═══════════════════════════════════════════════════════════════

let STREAK_CURRENT = 0;
let STREAK_BEST    = 0;  // session best; loaded from localStorage

(function loadStreakBest() {
  try { STREAK_BEST = parseInt(localStorage.getItem('istqb_streak_best')) || 0; } catch(e) {}
})();

function saveStreakBest() {
  try { localStorage.setItem('istqb_streak_best', STREAK_BEST); } catch(e) {}
}

function toggleStreakSources(checked) {
  document.querySelectorAll('.streak-src-cb').forEach(cb => cb.checked = checked);
}

function getStreakSelectedSources() {
  const allCb = document.getElementById('streak-src-all-he');
  if (allCb && allCb.checked) return [];
  return [...document.querySelectorAll('.streak-src-cb:checked')].map(cb => cb.value);
}

window.beginStreakMode = function() {
  const sources = getStreakSelectedSources();
  const klevel  = document.getElementById('streak-sel-klevel')?.value || 'all';

  let pool = [...ACTIVE_Q];
  if (sources.length > 0) pool = pool.filter(q => sources.includes(q.src));
  if (klevel !== 'all')   pool = pool.filter(q => (q.k_level || q.k) === klevel);

  const he = CURRENT_LANG === 'he';
  if (pool.length === 0) {
    alert(he ? 'אין שאלות עבור הסינון שנבחר.' : 'No questions match the selected filters.');
    return;
  }
  startStreakMode(pool);
};

function startStreakMode(pool) {
  STREAK_CURRENT = 0;
  if (!pool) pool = [...ACTIVE_Q];
  SESSION.mode = 'streak';
  runQuiz(shuffle(pool));

  // Show streak bar, hide normal score
  const streakBar = document.getElementById('streak-bar');
  const scoreBadge = document.getElementById('score-live');
  if (streakBar)  streakBar.classList.remove('hidden');
  if (scoreBadge) scoreBadge.classList.add('hidden');

  updateStreakDisplay();
  updateStreakBestBadge();

  // Hide skip button in streak mode
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) btnSkip.classList.add('hidden');
}

function streakOnCorrect() {
  STREAK_CURRENT++;
  updateStreakDisplay();

  // Milestone sounds: every 5 correct in a row
  if (STREAK_CURRENT > 0 && STREAK_CURRENT % 5 === 0) {
    SFX.roundComplete();
  }
}

function updateStreakDisplay() {
  const el = document.getElementById('streak-counter');
  if (el) {
    const emoji = STREAK_CURRENT >= 20 ? '🏆' : STREAK_CURRENT >= 10 ? '⚡' : '🔥';
    el.textContent = `${emoji} ${STREAK_CURRENT}`;
    // Pulse animation on update
    el.style.transform = 'scale(1.3)';
    setTimeout(() => { el.style.transform = 'scale(1)'; el.style.transition = 'transform 0.2s'; }, 150);
  }
}

function updateStreakBestBadge() {
  const el = document.getElementById('streak-best-badge');
  if (el) el.textContent = `שיא: ${STREAK_BEST || '—'}`;
  // Also update home card
  const homeEl = document.getElementById('streak-best-home');
  if (homeEl) homeEl.textContent = `שיא: ${STREAK_BEST || '—'}`;
}

function streakGameOver() {
  const isNewBest = STREAK_CURRENT > STREAK_BEST;
  if (isNewBest) {
    STREAK_BEST = STREAK_CURRENT;
    saveStreakBest();
    updateStreakBestBadge();
  }

  const overlay      = document.getElementById('streak-gameover');
  const finalEl      = document.getElementById('streak-final');
  const newBestEl    = document.getElementById('streak-new-best');
  const prevBestLine = document.getElementById('streak-prev-best-line');

  if (finalEl)    finalEl.textContent = STREAK_CURRENT;
  if (newBestEl)  newBestEl.classList.toggle('hidden', !isNewBest);
  if (prevBestLine) {
    prevBestLine.textContent = isNewBest
      ? `השיא הקודם שלך היה ${STREAK_BEST === STREAK_CURRENT ? 0 : STREAK_BEST}`
      : `השיא שלך: ${STREAK_BEST}`;
  }

  // Show the question that was answered wrong
  const wrongAnswer = SESSION.answers[SESSION.idx];
  const wrongSummary = document.getElementById('streak-wrong-summary');
  if (wrongAnswer && wrongAnswer.q && wrongSummary) {
    const q = wrongAnswer.q;
    const he = CURRENT_LANG === 'he';
    const letters = he ? ['א','ב','ג','ד','ה','ו'] : ['A','B','C','D','E','F'];
    const correctArr = Array.isArray(q.ans) ? q.ans : [q.ans];
    const correctText = correctArr.map(i => `${letters[i]}) ${q.opts[i]}`).join(' + ');
    const chosenIdxs = wrongAnswer.chosenMulti || (wrongAnswer.chosen >= 0 ? [wrongAnswer.chosen] : []);
    const chosenText = chosenIdxs.length > 0
      ? chosenIdxs.map(i => `${letters[i]}) ${q.opts[i]}`).join(' + ')
      : (he ? 'לא נבחר' : 'None');

    document.getElementById('streak-wrong-q').textContent = q.q.length > 100 ? q.q.slice(0, 100) + '…' : q.q;
    document.getElementById('streak-wrong-correct').textContent = `✓ ${he ? 'נכון' : 'Correct'}: ${correctText}`;
    document.getElementById('streak-wrong-chosen').textContent  = `✗ ${he ? 'בחרת' : 'You chose'}: ${chosenText}`;
    wrongSummary.classList.remove('hidden');
  } else if (wrongSummary) {
    wrongSummary.classList.add('hidden');
  }

  if (overlay) overlay.classList.remove('hidden');
  SFX.quizFail();
}

function streakRestart() {
  const overlay = document.getElementById('streak-gameover');
  if (overlay) overlay.classList.add('hidden');
  showScreen('streak-config');
}

function streakQuit() {
  const overlay = document.getElementById('streak-gameover');
  if (overlay) overlay.classList.add('hidden');
  // Restore UI
  const streakBar = document.getElementById('streak-bar');
  const scoreBadge = document.getElementById('score-live');
  if (streakBar)  streakBar.classList.add('hidden');
  if (scoreBadge) scoreBadge.classList.remove('hidden');
  navTo('home');
}

// Make sure streak UI resets when leaving quiz normally
const _origShowScreen = window.showScreen;
window.showScreen = function(id) {
  if (id !== 'quiz' && SESSION.mode === 'streak') {
    const streakBar  = document.getElementById('streak-bar');
    const scoreBadge = document.getElementById('score-live');
    const overlay    = document.getElementById('streak-gameover');
    if (streakBar)  streakBar.classList.add('hidden');
    if (scoreBadge) scoreBadge.classList.remove('hidden');
    if (overlay)    overlay.classList.add('hidden');
  }
  if (_origShowScreen) return _origShowScreen.call(this, id);
};


// ═══════════════════════════════════════════════════════════════
// SOUND ENGINE  (Web Audio API — zero dependencies)
// ═══════════════════════════════════════════════════════════════

const SFX = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Core tone builder
  function tone({ freq = 440, freq2, type = 'sine', gain = 0.18, attack = 0.005,
                   decay = 0.08, sustain = 0.6, release = 0.18, duration = 0.25 } = {}) {
    if (muted) return;
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.connect(env);
      env.connect(c.destination);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (freq2) osc.frequency.linearRampToValueAtTime(freq2, c.currentTime + duration);

      env.gain.setValueAtTime(0, c.currentTime);
      env.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
      env.gain.linearRampToValueAtTime(gain * sustain, c.currentTime + attack + decay);
      env.gain.setValueAtTime(gain * sustain, c.currentTime + duration - release);
      env.gain.linearRampToValueAtTime(0, c.currentTime + duration);

      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration + 0.01);
    } catch(e) {}
  }

  function chord(freqs, opts = {}) {
    freqs.forEach((f, i) => setTimeout(() => tone({ freq: f, ...opts }), i * (opts.stagger || 0)));
  }

  // ── Public sounds ──

  function correct() {
    // Bright two-note ding: root + fifth
    tone({ freq: 523.25, type: 'triangle', gain: 0.14, duration: 0.18, attack: 0.003, release: 0.12 });
    setTimeout(() => tone({ freq: 783.99, type: 'triangle', gain: 0.12, duration: 0.22, attack: 0.003, release: 0.18 }), 80);
  }

  function wrong() {
    // Low dull thud
    tone({ freq: 220, freq2: 160, type: 'sawtooth', gain: 0.12, duration: 0.22, attack: 0.003, decay: 0.05, sustain: 0.3, release: 0.15 });
  }

  function match() {
    // Satisfying pop + shimmer
    tone({ freq: 660, type: 'sine', gain: 0.13, duration: 0.12, attack: 0.002, release: 0.1 });
    setTimeout(() => tone({ freq: 880, type: 'sine', gain: 0.09, duration: 0.15, attack: 0.002, release: 0.13 }), 55);
  }

  function matchWrong() {
    // Short buzz
    tone({ freq: 180, freq2: 140, type: 'square', gain: 0.08, duration: 0.15, attack: 0.002, release: 0.1 });
  }

  function roundComplete() {
    // Rising arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', gain: 0.11, duration: 0.18, attack: 0.003, release: 0.14 }), i * 90));
  }

  function nextQuestion() {
    // Soft neutral tick
    tone({ freq: 380, type: 'sine', gain: 0.06, duration: 0.08, attack: 0.002, release: 0.06 });
  }

  function quizWin() {
    // Triumphant fanfare
    const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const delays =  [0,       120,    240,    380,    480,    560];
    melody.forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', gain: 0.13, duration: 0.22, attack: 0.003, release: 0.16 }), delays[i]));
  }

  function quizFail() {
    // Descending sad tones
    const notes = [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', gain: 0.1, duration: 0.28, attack: 0.005, release: 0.22 }), i * 130));
  }

  function flipCard() {
    // Light whoosh-click
    tone({ freq: 800, freq2: 400, type: 'sine', gain: 0.05, duration: 0.1, attack: 0.001, release: 0.09 });
  }

  function markKnown() {
    // Soft star chime
    tone({ freq: 1046.5, type: 'sine', gain: 0.08, duration: 0.15, attack: 0.003, release: 0.13 });
  }

  function navClick() {
    tone({ freq: 440, type: 'sine', gain: 0.04, duration: 0.06, attack: 0.001, release: 0.05 });
  }

  function toggleMute() { muted = !muted; return muted; }
  function isMuted() { return muted; }

  return { correct, wrong, match, matchWrong, roundComplete, nextQuestion,
           quizWin, quizFail, flipCard, markKnown, navClick, toggleMute, isMuted };
})();

// Expose globally
window.SFX = SFX;

window.toggleSfx = function() {
  const muted = SFX.toggleMute();
  const btn = document.getElementById('sfx-switch-btn');
  if (btn) btn.classList.toggle('on', !muted);
};
