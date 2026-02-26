# ✦ ISTQB CTFL · Quiz Trainer

> אפליקציית תרגול לבחינת הסמכת **ISTQB Foundation Level (CTFL)** — עם מעקב התקדמות, היסטוריית קוויזים ושמירה בענן.

![ISTQB Quiz Trainer](https://img.shields.io/badge/ISTQB-CTFL%20Prep-6c63ff?style=for-the-badge)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-orange?style=for-the-badge&logo=firebase)
![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-yellow?style=for-the-badge&logo=javascript)

---

## 🎯 מה זה?

אפליקציית Single Page Application (SPA) לתרגול לבחינת ISTQB CTFL.  
האפליקציה מכילה שאלות מ-4 מקורות שונים ומאפשרת תרגול ממוקד, מעקב אחר שגיאות ושמירת התקדמות בענן עם Google Login.

---

## ✨ פיצ'רים

- 🎲 **Random Quiz** — שאלות אקראיות מכל הבנק, ניתן להגדיר מקור וכמות
- 📋 **Full Exam Simulation** — סימולציית בחינה מלאה של 40 שאלות
- ⚡ **Review Mistakes** — תרגול ממוקד על שאלות שנענו לא נכון
- 📚 **By Source** — תרגול לפי מקור ספציפי (Sample Exam / Exam B / Exam C / General)
- 📊 **עמוד סטטיסטיקות** — ביצועים, כיסוי בנק השאלות, אחוז דיוק, היסטוריית קוויזים
- ℹ️ **עמוד אודות** — מידע על הבחינה והאפליקציה
- 🔐 **Google Login** — שמירת נתונים ב-Firebase Firestore בין מכשירים
- 🌙 **Dark mode** — עיצוב כהה מלא

---

## 🗂️ מבנה הפרויקט

```
├── index.html        # כל האפליקציה — HTML, CSS, JS בקובץ אחד
└── questions.json    # בנק השאלות
```

### מבנה `questions.json`

```json
[
  {
    "src": "Sample Exam",
    "q": "טקסט השאלה",
    "opts": ["אפשרות א", "אפשרות ב", "אפשרות ג", "אפשרות ד"],
    "ans": 0,
    "exp": "הסבר התשובה הנכונה...",
    "k": "K2",
    "lo": "1.2.1"
  }
]
```

| שדה | תיאור |
|-----|-------|
| `src` | מקור השאלה: `General`, `Sample Exam`, `Exam B`, `Exam C` |
| `q` | טקסט השאלה |
| `opts` | מערך של 4 אפשרויות תשובה |
| `ans` | אינדקס התשובה הנכונה (0–3) |
| `exp` | הסבר (אופציונלי) |
| `k` | רמת ידע: K1 / K2 / K3 (אופציונלי) |
| `lo` | Learning Objective (אופציונלי) |

---

## 🚀 הרצה מקומית

```bash
# Clone
git clone https://github.com/<your-username>/istqb-quiz-trainer.git
cd istqb-quiz-trainer

# הפעל שרת מקומי (נדרש בגלל fetch של questions.json)
npx serve .
# או
python3 -m http.server 8080
```

פתח את הדפדפן בכתובת `http://localhost:8080`

> ⚠️ **חשוב:** האפליקציה משתמשת ב-`fetch('questions.json')` ולכן **לא תעבוד** עם פתיחה ישירה של הקובץ (`file://`). יש להשתמש בשרת HTTP.

---

## 🔥 הגדרת Firebase

האפליקציה משתמשת ב-Firebase לאימות משתמשים ושמירת נתונים.

### שלבים:

1. צור פרויקט ב-[Firebase Console](https://console.firebase.google.com)
2. הפעל **Authentication → Google**
3. הפעל **Firestore Database**
4. הוסף את הדומיין שלך ל-**Authorized domains**
5. החלף את ה-`firebaseConfig` ב-`index.html`:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

### מבנה Firestore:

```
users/
  {uid}/
    ├── name
    ├── email
    ├── lastLogin
    ├── best          ← ציון הטוב ביותר
    ├── wrongIds[]    ← אינדקסים של שאלות שגויות
    ├── answeredIds[] ← כל התשובות (כולל חזרות)
    ├── uniqueIds[]   ← שאלות ייחודיות שנוסו
    └── quizHistory/
          └── {id}: { date, score, correct, wrong, skipped, mode, passed }
```

### Firestore Rules מינימליות:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 📦 Deploy ל-GitHub Pages

```bash
# ודא ש-index.html ו-questions.json נמצאים ב-root
git add .
git commit -m "Initial commit"
git push origin main
```

ב-Settings → Pages → Source: `main` / `root`

> 💡 אחרי Deploy, הוסף את כתובת ה-GitHub Pages שלך ל-**Firebase Authorized Domains**

---

## 🛠️ טכנולוגיות

| טכנולוגיה | שימוש |
|-----------|-------|
| Vanilla JS (ES6+) | לוגיקת האפליקציה |
| HTML5 / CSS3 | מבנה ועיצוב |
| Firebase Auth | Google Login |
| Firebase Firestore | שמירת נתונים בענן |
| Google Fonts (Syne, Space Mono, Inter) | טיפוגרפיה |
| localStorage | שמירה מקומית כשאין חיבור |

---

## 📄 רישיון

MIT License — חופשי לשימוש אישי ולימודי.
