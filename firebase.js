// ========== Firebase Auth + Firestore Module ==========

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
  import { getFirestore, doc, setDoc, getDoc, deleteDoc, collection, addDoc, getDocs, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
  import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBpi_2xLpUL7FNlDRLHW8GTiRTkq5trnfY",
    authDomain: "istqb-practice-app.firebaseapp.com",
    projectId: "istqb-practice-app",
    storageBucket: "istqb-practice-app.firebasestorage.app",
    messagingSenderId: "246584838246",
    appId: "1:246584838246:web:d6bd6e8d0f7bcca184c5a7",
    measurementId: "G-YC3EWP3D40"
  };

  const app      = initializeApp(firebaseConfig);
  const db       = getFirestore(app);
  const auth     = getAuth(app);
  const provider = new GoogleAuthProvider();

  // ── Save user data to Firestore ──
  window._fbSaveUserData = async function({ wrongIds, best, answeredIds, uniqueIds, starredIds, notes }) {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, "users", uid), {
      wrongIds,
      best:        best        ?? null,
      answeredIds: answeredIds ?? [],
      uniqueIds:   uniqueIds   ?? [],
      starredIds:  starredIds  ?? [],
      notes:       notes       ?? {},
      updatedAt:   serverTimestamp()
    }, { merge: true });
  };

  // ── Clear all stats from Firestore (overwrite + delete history sub-collection) ──
  window._fbClearUserData = async function() {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    // Overwrite user doc with empty stats (no merge — replaces completely)
    await setDoc(doc(db, "users", uid), {
      name:        window._currentUser.displayName,
      email:       window._currentUser.email,
      wrongIds:    [],
      best:        null,
      answeredIds: [],
      uniqueIds:   [],
      updatedAt:   serverTimestamp()
    });
    // Delete all quizHistory documents
    const histSnap = await getDocs(collection(db, "users", uid, "quizHistory"));
    const deletes = histSnap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletes);
  };

  // ── Save a quiz result to history sub-collection ──
  window._fbSaveQuizHistory = async function(entry) {
    const uid = window._currentUser?.uid;
    if (!uid) return;
    await addDoc(collection(db, "users", uid, "quizHistory"), {
      ...entry,
      timestamp: serverTimestamp()
    });
  };

  window.loginWithGoogle = async function() {
    try {
      const result = await signInWithPopup(auth, provider);
    } catch (error) {
      if (error.code === 'auth/popup-closed-by-user' ||
          error.code === 'auth/cancelled-popup-request') return;
      console.error("שגיאה בהתחברות:", error);
      alert("שגיאה בהתחברות: " + error.message);
    }
  };

  window.logoutGoogle = async function() {
    try { await auth.signOut(); }
    catch (e) { console.error(e); }
  };

  // Fetch quiz history from Firestore sub-collection
  async function fetchQuizHistory(uid) {
    try {
      const { getDocs, query, orderBy, limit } =
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const q = query(collection(db, "users", uid, "quizHistory"), orderBy("timestamp","desc"), limit(50));
      const snap = await getDocs(q);
      QUIZ_HISTORY = snap.docs.map(d => ({ ...d.data(), date: d.data().date || new Date().toISOString() })).reverse();
    } catch(e) { console.warn("Could not load quiz history", e); }
  }

  window._fbClearHistory = async function() {
    const uid = window._currentUser?.uid;
    if (!uid) return;

    // 1. Wipe main user document fields
    await setDoc(doc(db, "users", uid), {
      wrongIds: [], best: null, answeredIds: [], uniqueIds: [], updatedAt: serverTimestamp()
    }, { merge: true });

    // 2. Delete all quizHistory sub-collection documents
    try {
      const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const histSnap = await getDocs(collection(db, "users", uid, "quizHistory"));
      const deletes = histSnap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletes);
    } catch(e) { console.warn("Could not delete quizHistory", e); }

    QUIZ_HISTORY = [];
  };

  onAuthStateChanged(auth, async (user) => {
    const loginWall   = document.getElementById('login-wall');
    const userInfoDiv = document.getElementById('user-info');
    const btnLogin    = document.getElementById('btn-login');
    const btnLogout   = document.getElementById('btn-logout');

    if (user) {
      window._currentUser = user;
      window._authReady = true;

      // Hide login wall, show app
      if (loginWall) loginWall.classList.add('hidden');

      // Update auth UI
      if (userInfoDiv) userInfoDiv.innerText = "שלום, " + user.displayName;
      if (btnLogin)  btnLogin.classList.add('hidden');
      if (btnLogout) btnLogout.classList.remove('hidden');

      // Save/update profile
      await setDoc(doc(db, "users", user.uid), {
        name: user.displayName,
        email: user.email,
        lastLogin: serverTimestamp()
      }, { merge: true });

      // Load data from Firestore
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) await window.loadCloudData(snap.data());
      await fetchQuizHistory(user.uid);

      // Init app now that we have both auth + data
      if (window._questionsReady) window.init();
      else window._authReady = true;

    } else {
      window._currentUser = null;
      window._authReady = true;

      // Guest mode: hide login wall, allow play without saving
      if (loginWall) loginWall.classList.add('hidden');
      WRONG_IDS = []; BEST = null; ANSWERED_IDS = []; UNIQUE_IDS = []; QUIZ_HISTORY = [];

      if (userInfoDiv) userInfoDiv.innerText = "אורח";
      if (btnLogin)  btnLogin.classList.remove('hidden');
      if (btnLogout) btnLogout.classList.add('hidden');

      // Init app if questions are ready
      if (window._questionsReady) window.init();
    }
  });